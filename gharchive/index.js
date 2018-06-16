const fs = require('fs')
const zlib = require('zlib')
const JSONStream = require('json-stream')
const util = require('./util')
const bent = require('bent')

const ipfsAPI = require('ipfs-api')

const findNum = event => {
  let num
  if (event.payload.pull_request) {
    num = event.payload.pull_request.number
  } else if (event.payload.issue) {
    num = event.payload.issue.number
  } else {
    num = event.payload.number
  }
  if (!num) {
    console.error(event)
    throw new Error('Could not get ticket number.')
  }
  return num
}

const findCommit = event => {
  let commit
  if (event.payload.head) {
    commit = event.payload.head
  } else if (event.payload.comment) {
    commit = event.payload.comment.commit_id
  }
  if (!commit) {
    console.error(event)
    throw new Error('Could not get commit.')
  }
  return commit
}

const getFilename = {}
getFilename.PushEvent = event => {
  return `commits/${findCommit(event)}/${event.created_at}.json`
}
getFilename.CreateEvent = event => {
  return `${event.created_at}.json`
}
getFilename.PullRequestEvent = event => {
  return `prs/${findNum(event)}/${event.created_at}.json`
}
getFilename.ForkEvent = event => {
  return `forks/${event.created_at}.json`
}
getFilename.IssuesEvent = event => {
  return `issues/${findNum(event)}/${event.created_at}.json`
}
getFilename.IssueCommentEvent = event => {
  return `issues/${findNum(event)}/${event.created_at}.json`
}
getFilename.WatchEvent = event => {
  return `watchers/${event.created_at}.json`
}
getFilename.DeleteEvent = event => {
  return `${event.created_at}.json`
}
getFilename.PullRequestReviewCommentEvent = event => {
  return `prs/${findNum(event)}/${event.created_at}.json`
}
getFilename.GollumEvent = event => {
  return `wiki/${event.created_at}.json`
}
getFilename.MemberEvent = event => {
  return `members/${event.created_at}.json`
}
getFilename.CommitCommentEvent = event => {
  return `commits/${findCommit(event)}/${event.created_at}.json`
}
getFilename.ReleaseEvent = event => {
  return `releases/${event.created_at}.json`
}
getFilename.PublicEvent = event => {
  return `${event.created_at}.json`
}

let ipfs = ipfsAPI('/ip4/127.0.0.1/tcp/5001')

// const addMany = () => {
//   let stream = ipfs.files.addReadableStream()
//   let results = []
//   stream.on('data', o => results.push(o))

//   let promise = new Promise((resolve, reject) => {
//     stream.on('error', reject)
//     stream.on('end', () => {
//       resolve(results)
//     })
//   })

//   return [stream, promise]
// }

const _mkdir = async f => {
  let ret
  try {
    ret = await ipfs.files.mkdir(f, {parents: true})
  } catch (e) {
    if (e.message !== 'file already exists') throw e
  }
  return ret
}

const _write = async (path, content) => {
  let dir = path.slice(0, path.lastIndexOf('/'))
  await _mkdir(dir)
  let ret
  try {
    ret = await ipfs.files.write(path, content, {create: true})
  } catch (e) {
    throw e
  }
  return ret
}

// const mkdirs = async (results, prefix) => {
//   let paths = new Set()
//   results.forEach(r => {
//     let dir = r.path.slice(0, r.path.lastIndexOf('/'))
//     paths.add(prefix + dir)
//   })
//   let promises = Array.from(paths).map(p => {
//     return _mkdir(p)
//   })
//   return Promise.all(promises)
// }

// const writeFiles = async (results, prefix) => {
//   let promises = results.map(r => {
//     let path = prefix + r.path
//     return ipfs.files.cp([`/ipfs/${r.hash}`, path])
//   })
//   return Promise.all(promises)
// }

const getHttp = bent('GET', 200)

const process = async (filename, prefix='/gharchive-test') => {
  let url = `http://data.gharchive.org/${filename}`
  console.log({url})
  let stream = await getHttp(url)
  let reader = stream.pipe(zlib.createUnzip()).pipe(JSONStream())

  for await (let obj of reader) {
    let repo = util.identifyRepo(obj)

    // TODO: polyfill created_at in older objects

    if (getFilename[obj.type]) {
      let path = `${prefix}/${repo}/${getFilename[obj.type](obj)}`
      await _write(path, Buffer.from(JSON.stringify(obj)))
    } else {
      console.error(obj.type)
    }
  }
  await _write(`${prefix}/.receipts/${filename}`, Buffer.from(Date.now().toString()))
}

const run = async () => {
  let files = []
  for (let i = 0; i < 24; i++) {
    files.push(`2018-01-01-${i}.json.gz`)
  }

  for (f of files) {
    await process(f)
  }
}
run()