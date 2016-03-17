import {RTSPMessage} from './rtsp/message';
import {LogLevel} from 'bp_logger';

export var RTSP_CONFIG={
    "backend":"websocket",
    "websocket.url": `ws://${window.location.host}/ws/`,
    "log": LogLevel.Error
};


export const MessageBuilder = new RTSPMessage(RTSPMessage.RTSP_1_0);