export class Url {
    static parse(url) {
        var ret = {};

        var regex = /^([^:]+):\/\/([^\/]+)(.*)$/;  //protocol, login, urlpath
        var result = regex.exec(url);

        ret.full = url;
        ret.protocol = result[1];
        ret.urlpath = result[3];

        var parts = ret.urlpath.split('/');
        ret.basename = parts.pop().split(/\?|#/)[0];
        ret.basepath = parts.join('/');

        var loginSplit = result[2].split('@');
        var hostport = loginSplit[0].split(':');
        var userpass = [ null, null ];
        if (loginSplit.length === 2) {
            userpass = loginSplit[0].split(':');
            hostport = loginSplit[1].split(':');
        }

        ret.user = userpass[0];
        ret.pass = userpass[1];
        ret.host = hostport[0];
        ret.auth = (ret.user && ret.pass) ? `${ret.user}:${ret.pass}` : '';

        ret.port = (null == hostport[1]) ? Url.protocolDefaultPort(ret.protocol) : hostport[1];
        ret.portDefined = (null != hostport[1]);
        ret.location = `${ret.host}:${ret.port}`;

        if (ret.protocol == 'unix') {
            ret.socket = ret.port;
            ret.port = undefined;
        }

        return ret;
    }

    static full(parsed) {
        return `${parsed.protocol}://${parsed.auth?parsed.auth+'@':''}${parsed.location}/${parsed.urlpath}`;
    }

    static isAbsolute(url) {
        return /^[^:]+:\/\//.test(url);
    }

    static protocolDefaultPort(protocol) {
        switch (protocol) {
            case 'rtsp': return 554;
            case 'http': return 80;
            case 'https': return 443;
        }

        return 0;
    }
}