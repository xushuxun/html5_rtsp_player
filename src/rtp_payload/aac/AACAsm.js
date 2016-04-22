import {AACFrame} from './AACFrame';
// TODO: asm.js
export class AACAsm {
    constructor() {
        this.config = null;
    }

    static onRTPPacket(pkt) {
        let rawData = pkt.getPayload();
        if (!pkt.media) {
            return null;
        }
        let data = new DataView(rawData.buffer, rawData.byteOffset);

        let sizeLength = pkt.media.fmtp['sizelength'] || 0;
        let indexLength = pkt.media.fmtp['indexlength'] || 0;
        let indexDeltaLength = pkt.media.fmtp['indexdeltalength'] || 0;
        let CTSDeltaLength = pkt.media.fmtp['ctsdeltalength'] || 0;
        let DTSDeltaLength = pkt.media.fmtp['dtsdeltalength'] || 0;
        let RandomAccessIndication = pkt.media.fmtp['randomaccessindication'] || 0;
        let StreamStateIndication = pkt.media.fmtp['streamstateindication'] || 0;
        let AuxiliaryDataSizeLength = pkt.media.fmtp['auxiliarydatasizelength'] || 0;

        let configHeaderLength =
            sizeLength + Math.max(indexLength, indexDeltaLength) + CTSDeltaLength + DTSDeltaLength +
            RandomAccessIndication + StreamStateIndication + AuxiliaryDataSizeLength;


        let auHeadersLengthPadded = 0;
        if (0 !== configHeaderLength) {
            /* The AU header section is not empty, read it from payload */
            let auHeadersLengthInBits = data.getUint16(0); // Always 2 octets, without padding
            auHeadersLengthPadded = 2 + (auHeadersLengthInBits + auHeadersLengthInBits % 8) / 8; // Add padding

            this.config = new Uint8Array(rawData, 0 , auHeadersLengthPadded);
        }

        return new AACFrame(rawData.slice(auHeadersLengthPadded), pkt.getTimestampMS());
    }
}