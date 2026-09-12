const zlib=require('node:zlib');
const payload=[require('../bundle/gateway-00.js'),require('../bundle/gateway-01.js'),require('../bundle/gateway-02.js'),require('../bundle/gateway-03.js'),require('../bundle/gateway-04.js'),require('../bundle/gateway-05.js'),require('../bundle/gateway-06.js'),require('../bundle/gateway-07.js'),require('../bundle/gateway-08.js'),require('../bundle/gateway-09.js'),require('../bundle/gateway-10.js')].join('');
let handler;
function load(){if(handler)return handler;const src=zlib.gunzipSync(Buffer.from(payload,'base64')).toString('utf8');const mod={exports:{}};new Function('module','exports','require','__filename','__dirname',src)(mod,mod.exports,require,__filename,__dirname);handler=mod.exports;return handler;}
module.exports=async function(req,res){return load()(req,res);};
