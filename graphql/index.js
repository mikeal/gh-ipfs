const gh = require('./gh')

const repoQuery = (nameWithOwner) => {
  let [owner, name] = nameWithOwner.split('/')
  return `
  query {
    repository (owner: "${owner}", name: "${name}") {
      id
      createdAt
      databaseId
      description
      diskUsage
      forkCount
      hasIssuesEnabled
      hasWikiEnabled
      homepageUrl
      isArchived
      isFork
      isLocked
      license
      nameWithOwner
      primaryLanguage {
        name
      }
      pushedAt
      issues (first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          updatedAt
        }
        totalCount
      }
      pullRequests (first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          updatedAt
        }
        totalCount
      }
      forks (first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
        nodes {
          createdAt
        }
        totalCount
      }
    }
  }
  `
}

const issueAllQuery = (nameWithOwner, after) => {
  let [owner, name] = nameWithOwner.split('/')
  if (after) {
    after = `, after: "${after}"`
  } else {
    after = ''
  }
  return `
  query {
    repository (owner: "${owner}", name: "${name}") {
      issues (first: 100, orderBy: {field: UPDATED_AT, direction: DESC}${after}) {
        totalCount
        pageInfo {
          endCursor
        }
        nodes {
          id
          assignees (first: 100) {
            nodes {
              id
              login
            }
            totalCount
          }
          author {
            login
          }
          comments (first: 100) {
            pageInfo {
              endCursor
            }
            nodes {
              author {
                login
              }
              createdAt
              editor {
                login
              }
              id
              updatedAt
              reactionGroups {
                users (first: 1) {
                  totalCount
                }
              }
            }
            totalCount
          }
          closed
          closedAt
          createdAt
          locked
          milestone {
            id
            number
            title
          }
          number
          title
          updatedAt
        }
      }
    }
  }
  `
}

const get = async (ipfs, path) => {
  let buff = null
  try {
    buff = await ipfs.files.read(path)
  } catch (e) {
    if (e.message !== 'file does not exist') throw e
  }
  if (!buff) return buff
  return JSON.parse(buff.toString())
}

const put = async (ipfs, path, obj) => {
  // TODO: remove first
  let buff = Buffer.from(JSON.stringify(obj))
  let value = await ipfs.add(buff)
  let dir = path.slice(0, path.lastIndexOf('/'))
  await ipfs.files.mkdir(dir, {parents: true})
  return ipfs.files.cp([`/ipfs/${value[0].hash}`, path])
}

const ls = async (ipfs, path) => {
  let _files
  try {
    _files = await ipfs.files.ls(path)
  } catch (e) {
    if (e.message !== 'file does not exist') throw e
  }
  if (!_files) return []
  let files = await Promise.all(_files.map(f => {
    return get(ipfs, `${path}/${f.name}`)
  }))
  return files
}

const findOldest = issues => {
  let oldest = Infinity
  issues.forEach(issue => {
    let time = (new Date(issue.updatedAt)).getTime()
    if (time < oldest) oldest = time
  })
  return oldest
}

class GHIPFS {
  constructor (ipfs, token) {
    this.ipfs = ipfs
    this.query = gh(token)
  }
  async repo (name) {
    let info = await get(this.ipfs, `/gh-graphql/${name}/info.json`)
    if (!info) {
      info = await this.query(repoQuery(name))
      await put(this.ipfs, `/gh-graphql/${name}/info.json`, info)
    }
    // let issues = await ls(this.ipfs, `/gh-graphql/${name}/issues`)
    // console.log(issues)
    let issues = await this.getIssues(name)
    issues.forEach(issue => {
      console.log(issue.comments)
    })
  }
  async getIssues (name, updatedAt) {
    let issues = await ls(this.ipfs, `/gh-graphql/${name}/issues`)
    let times = issues.map(issue => {
      return (new Date(issue.updatedAt)).getTime()
    }).sort()
    let lastUpdate = times[times.length - 1]
    if (!lastUpdate) lastUpdate = (new Date('1983-01-01')).getTime()
    if (lastUpdate === updatedAt) {
      return issues
    }

    _issues = {}
    issues.forEach(issue => _issues[issue.number] = issue)

    let data = new Map()

    let response = await this.query(issueAllQuery(name))

    let setData = nodes => {
      nodes.forEach(issue => {
        if (_issues[issue.id] &&
            _issues[issue.id].updatedAt === issue.updatedAt) {
          return // skip issues with no updates.
        }
        data.set(issue.id, issue)
      })
    }
    setData(response.repository.issues.nodes)

    console.log('test')
    let total = response.repository.issues.totalCount
    let oldest = findOldest(response.repository.issues.nodes)
    let after

    while (data.size < total && oldest >= lastUpdate) {
      console.log('get', after)
      after = response.repository.issues.pageInfo.endCursor
      response = await this.query(issueAllQuery(name, after))
      setData(response.repository.issues.nodes)
      // TODO: break out comments.
      oldest = findOldest(response.repository.issues.nodes)
    }
    // TODO: page issues.
    console.log(data.size)

    await Promise.all(Array.from(data.values()).map(issue => {
      let path = `/gh-graphql/${name}/issues/${issue.number}.json`
      return put(this.ipfs, path, issue)
    }))
    console.log('write')

    issues.forEach(issue => {
      if (!data.has(issue.id)) data.set(issue.id, issue)
    })

    return Array.from(data.values())
  }
}

module.exports = (...args) => new GHIPFS(...args)
