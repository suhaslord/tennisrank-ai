const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const root=process.cwd(); const render=require(path.join(root,'api/render.js'));
http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(['/','/index.html','/qa-coach-index.html','/qa-ai-index.html','/admin','/player'].includes(pathname)) {
  res.status=function(s){this.statusCode=s;return this};res.send=function(s){this.end(s);return this};return render(req,res);
 }
 const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+'/')){res.writeHead(403).end();return}
 try { const content=fs.readFileSync(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain');res.end(content); } catch {res.writeHead(404).end()}
}).listen(4173,'127.0.0.1');
