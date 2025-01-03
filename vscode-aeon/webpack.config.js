/** @type {(env: any) => import('webpack').Configuration[]} */
module.exports = function (env) {
    env = env || {}
    env.production = !!env.production
    return [
    ]
}
