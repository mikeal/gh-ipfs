const { GraphQLClient } = require('graphql-request')

module.exports = token => {
  const client = new GraphQLClient('https://api.github.com/graphql', {
    headers: { Authorization: `Bearer ${token}` }
  })
  return query => client.request(query)
}
