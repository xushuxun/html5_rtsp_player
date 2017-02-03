import {AACFrame} from './AACFrame';
import {AACParser} from "../parsers/aac";
// TODO: asm.js
export class AACAsm {
    constructor() {
        this.config = null;
    }

    onAACFragment(pkt) {
        let rawData = pkt.getPayload();
        if (!pkt.media) {
            return null;
        }
        let data = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

        let sizeLength = Number(pkt.media.fmtp['sizelength'] || 0);
        let indexLength = Number(pkt.media.fmtp['indexlength'] || 0);
        let indexDeltaLength = Number(pkt.media.fmtp['indexdeltalength'] || 0);
        let CTSDeltaLength = Number(pkt.media.fmtp['ctsdeltalength'] || 0);
        let DTSDeltaLength = Number(pkt.media.fmtp['dtsdeltalength'] || 0);
        let RandomAccessIndication = Number(pkt.media.fmtp['randomaccessindication'] || 0);
        let StreamStateIndication = Number(pkt.media.fmtp['streamstateindication'] || 0);
        let AuxiliaryDataSizeLength = Number(pkt.media.fmtp['auxiliarydatasizelength'] || 0);

        let configHeaderLength =
            sizeLength + Math.max(indexLength, indexDeltaLength) + CTSDeltaLength + DTSDeltaLength +
            RandomAccessIndication + StreamStateIndication + AuxiliaryDataSizeLength;


        let auHeadersLengthPadded = 0;
        if (0 !== configHeaderLength) {
            /* The AU header section is not empty, read it from payload */
            let auHeadersLengthInBits = data.getUint16(0); // Always 2 octets, without padding
            auHeadersLengthPadded = 2 + ((auHeadersLengthInBits + (auHeadersLengthInBits & 0x7)) >>> 3); // Add padding

            //this.config = AACParser.parseAudioSpecificConfig(new Uint8Array(rawData, 0 , auHeadersLengthPadded));
            // TODO: parse config
        }

        let aacData = rawData.subarray(auHeadersLengthPadded);
        let offset = 0;
        while (true) {
            if (aacData[offset] !=255) break;
            ++offset;
        }

        ++offset;
        let ts = (Math.round(pkt.getTimestampMS()/1024) << 10) * 90000 / this.config.samplerate;
        return new AACFrame(rawData.subarray(auHeadersLengthPadded+offset), ts);
    }
}