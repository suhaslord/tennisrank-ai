const zlib=require('node:zlib');
const payload=[require('../bundle/render-00.js'),require('../bundle/render-01.js')].join('');
const html=zlib.gunzipSync(Buffer.from(payload,'base64')).toString('utf8');
module.exports=async function(req,res){if(req.method!=='GET'&&req.method!=='HEAD'){res.status(405).setHeader('Allow','GET, HEAD').end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-TennisRank-Commit',"c03f47b3520fef60ed7416c43e79cd8990250f9a");if(req.method==='HEAD')return res.status(200).end();return res.status(200).send(html);};
