import {LogLevel, getTagged, setDefaultLogLevel} from 'bp_logger';
import * as streamedian from 'streamedian/player.js';
import WebsocketTransport from 'streamedian/transport/websocket.js';
import RTSPClient from 'streamedian/client/rtsp/client.js';
import {isSafari} from "streamedian/core/util/browser.js";

setDefaultLogLevel(LogLevel.Debug);
getTagged("transport:ws").setLevel(LogLevel.Error);
getTagged("client:rtsp").setLevel(LogLevel.Error);

let wsTransport = {
    constructor: WebsocketTransport,
    options: {
        socket: "wss://specforge.com/ws/"
    }
};

window.StreamedianPlayer = new streamedian.WSPlayer('test_video', {
    // url: `${STREAM_UNIX}${STREAM_URL}`,
    // type: wsp.StreamType.RTSP,
    modules: [
        {
            client: RTSPClient,
            transport: wsTransport
        }
    ],
    errorHandler (e){
        alert(`Failed to start player: ${e.message}`);
    },
    queryCredentials(client) {
        return new Promise((resolve, reject)=>{
            let c = prompt('input credentials in format user:password');
            if (c) {
                this.setCredentials.apply(this, c.split(':'));
                resolve();
            } else {
                reject();
            }
        });
    }
});
