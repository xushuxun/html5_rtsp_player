const path = require('path');

const PATHS = {
    src: {
        test: path.join(__dirname, 'test.js')
    },
    dist: __dirname
};


module.exports = {
    entry: PATHS.src,
    output: {
        path: PATHS.dist,
        filename: '[name].bundle.js'
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                loader: 'babel',
                query: {
                    presets: ['es2015', 'stage-3', 'stage-2', 'stage-1', 'stage-0']
                }
            }
        ]
    },
    resolve: {
        alias: {
            rtsp: path.join(__dirname,'node_modules/html5_rtsp_player/src')
        }
    }
};