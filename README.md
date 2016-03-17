## Overview

html5_rtsp_player.js is a Javascript library which implements RTSP client for watching live streams in your browser 
that works directly on top of a standard HTML <video> element. 
It requires support of HTML5 Video with Media Sources Extensions for playback. Also player relies on server-side websocket 
proxy for retransmitting RTSP streams to browser.

![](http://www.specforge.com/images/html5_rtsp_player/html5_player.png)
   
It works by muxing RTP h.264 payload into ISO BMFF (MP4) fragments. 

html5_rtsp_player.js is written in ECMAScript6, and transpiled in ECMAScript5 using Babel.

## Install

npm install git://github.com/SpecForge/html5_rtsp_player.git

## Usage

### Browser side

Attach HTML Video with RTSP URL
```
<video id="test_video" controls autoplay src="rtsp://your_rtsp_stream/url"></video>
```

Setup player in your js:

```
import * as rtsp from 'rtsp_player';

rtsp.RTSP_CONFIG['websocket.url'] = "ws://websocket_proxy_address/ws";

let player = rtsp.attach(document.getElementById('test_video'));
```

ES6 Modules support is required. You can use webpack with babel loader to build this script:

webpack.config.js
```
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
            rtsp: path.join(__dirname,'node_modules/html5_rtsp/src')
        }
    }
};
```


```
> npm install bp_event bp_log bp_statemachine
> webpack --config webpack.config.js
```

Include compiled script into your HTML:

```
<script src="test.bundle.js"></script>
```

### Server side

1. Install websocket proxy

    _repo files will be included later_
        
    ```
    apt install wsock_rtsp_proxy # Debian-based systems
    ```

    or 
    
    ```
    dnf install wsock_rtsp_proxy # Fedora
    ```

2. Configure port in /etc/wsock_rtsp_proxy

3. Run it

```
> service wsock_rtsp_proxy start
```