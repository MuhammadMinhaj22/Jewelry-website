const express=require('express'),{DatabaseSync}=require('node:sqlite'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000,PASS=process.env.ADMIN_PASSWORD||'',WA=process.env.WHATSAPP||'923116052491';
const DB=process.env.DB_PATH||path.join(__dirname,'data','shop.db'),UP=process.env.UPLOAD_DIR||path.join(__dirname,'public','uploads');
// ---- startup safety: refuse to run with a missing/weak admin password or bad config
if(PASS.length<10||['admin123','change-this-strong-password'].includes(PASS)){console.error('FATAL: Set ADMIN_PASSWORD (at least 10 characters) as an environment variable.');process.exit(1)}
if(!/^\d{10,15}$/.test(WA)){console.error('FATAL: WHATSAPP must be digits only, e.g. 923116052491');process.exit(1)}
fs.mkdirSync(path.dirname(DB),{recursive:true});fs.mkdirSync(UP,{recursive:true});
const db=new DatabaseSync(DB);
db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;');
db.exec(`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),compare_at_price INTEGER,description TEXT DEFAULT '',img TEXT DEFAULT '',badge TEXT DEFAULT '',in_stock INTEGER DEFAULT 1,sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT DEFAULT CURRENT_TIMESTAMP,name TEXT,phone TEXT,address TEXT,items TEXT,total INTEGER,status TEXT DEFAULT 'new');
CREATE TABLE IF NOT EXISTS sessions(h TEXT PRIMARY KEY,exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT);`);
if(!db.prepare("SELECT v FROM meta WHERE k='seeded'").get()){ // seed once, never again (even if all products are deleted)
  const ins=db.prepare('INSERT OR IGNORE INTO products(id,name,category,price,compare_at_price,description,img,badge,in_stock,sort) VALUES(?,?,?,?,?,?,?,?,?,?)');
  try{JSON.parse(fs.readFileSync(path.join(__dirname,'seed','products.json'),'utf8')).forEach((p,i)=>{
    fs.copyFileSync(path.join(__dirname,'seed','images',p.image),path.join(UP,p.image));
    ins.run(p.id,p.name,p.category,p.price,p.compare_at_price||null,p.description,'/uploads/'+p.image,p.badge||'',p.in_stock=='no'?0:1,i)})}catch(e){console.error('Seed skipped:',e.message)}
  db.prepare("INSERT OR REPLACE INTO meta VALUES('seeded','1')").run();
}
const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
const app=express();app.disable('x-powered-by');
const TP=process.env.TRUST_PROXY;app.set('trust proxy',TP===undefined?1:/^\d+$/.test(TP)?+TP:TP);
app.use((q,r,n)=>{r.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"});
 if(q.secure)r.set('Strict-Transport-Security','max-age=15552000');
 if(q.path.startsWith('/admin'))r.set({'X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'});n()});
// CSRF: reject cross-site state-changing requests (cookie is also SameSite=Strict)
app.use((q,r,n)=>{if(q.method!=='GET'&&q.method!=='HEAD'&&q.headers.origin){try{const h=new URL(q.headers.origin).host;if(h!==q.headers.host&&h!==q.headers['x-forwarded-host'])return r.status(403).json({error:'Forbidden'})}catch(e){return r.status(403).json({error:'Forbidden'})}}n()});
app.use('/admin/api/products',express.json({limit:'6mb'})); // only the image-upload route may be large
app.use(express.json({limit:'20kb'}));
// ---- rate limiting (in memory, per IP)
const hits=new Map();
const tooMany=(k,max,ms)=>{const now=Date.now(),a=(hits.get(k)||[]).filter(t=>now-t<ms);a.push(now);hits.set(k,a);return a.length>max};
setInterval(()=>{const now=Date.now();for(const[k,a]of hits)if(!a.some(t=>now-t<36e5))hits.delete(k)},6e5).unref();
// ---- helpers
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const eq=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
const sid=q=>{const m=/(?:^|;\s*)sid=([a-f0-9]{48})/.exec(q.headers.cookie||'');return m&&m[1]};
const auth=(q,r,n)=>{const t=sid(q);if(t){const s=db.prepare('SELECT exp FROM sessions WHERE h=?').get(sha(t));if(s&&s.exp>Date.now())return n()}r.status(401).json({error:'Login required'})};
const clean=s=>String(s??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim();
const pub=p=>({...p,in_stock:!!p.in_stock});
const SLUG=/^[a-z0-9-]{1,60}$/,BADGES=['','New','Best Seller','Sale','Limited'],rs=n=>'Rs. '+n.toLocaleString('en-US');
// ---- public API
app.get('/api/products.js',(q,r)=>r.type('js').set('Cache-Control','no-cache').send('const WA_NUM='+JSON.stringify(WA)+';const P='+JSON.stringify(db.prepare('SELECT * FROM products WHERE in_stock=1 ORDER BY sort,rowid').all().map(pub)).replace(/</g,'\\u003c')+';'));
app.post('/api/orders',(q,r)=>{
  if(tooMany('O'+q.ip,10,36e5)||tooMany('OALL',300,36e5))return r.status(429).json({error:'Bohat zyada orders. Thori der baad koshish karein.'});
  const b=q.body||{},name=clean(b.name),phone=clean(b.phone),address=clean(b.address),raw=b.items;
  if(name.length<2||name.length>100||!/^[0-9+\-\s()]{7,20}$/.test(phone)||address.length<8||address.length>400)return r.status(400).json({error:'Sahi naam, phone number aur poora address likhein.'});
  if(!Array.isArray(raw)||!raw.length||raw.length>50)return r.status(400).json({error:'Cart khali hai ya ghalat hai.'});
  const want=new Map(); // merge duplicates; price/total are NEVER read from the client
  for(const it of raw){const id=String(it&&it.id||''),qty=+(it&&it.qty);if(!SLUG.test(id)||!Number.isInteger(qty)||qty<1||qty>20)return r.status(400).json({error:'Quantity ghalat hai.'});want.set(id,(want.get(id)||0)+qty)}
  try{
    const out=tx(()=>{let total=0;const lines=[];
      for(const[id,qty]of want){if(qty>20)throw Object.assign(new Error('qty'),{user:'Ek product ki quantity 20 se zyada nahi ho sakti.'});
        const p=db.prepare('SELECT id,name,price FROM products WHERE id=? AND in_stock=1').get(id);
        if(!p)throw Object.assign(new Error('na'),{user:'Cart ka koi product ab available nahi hai. Page refresh karein.'});
        total+=p.price*qty;lines.push({id:p.id,name:p.name,price:p.price,qty})}
      const o=db.prepare('INSERT INTO orders(name,phone,address,items,total) VALUES(?,?,?,?,?)').run(name,phone,address,JSON.stringify(lines),total);
      return{id:Number(o.lastInsertRowid),total,lines}});
    const message=`Assalam o Alaikum, I would like to confirm my order (Order #${out.id}):\n\n`+out.lines.map(l=>`• ${l.name} x${l.qty} = ${rs(l.price*l.qty)}`).join('\n')+`\n\nTotal: ${rs(out.total)}\nName: ${name}\nPhone: ${phone}\nAddress: ${address}\nPayment: Cash on Delivery`;
    r.json({id:out.id,total:out.total,message});
  }catch(e){if(e.user)return r.status(400).json({error:e.user});throw e}});
// ---- admin API
app.post('/admin/api/login',(q,r)=>{
  if(tooMany('L'+q.ip,8,9e5))return r.status(429).json({error:'Bohat zyada koshishein. 15 minute baad dobara try karein.'});
  const ok=typeof q.body.password==='string'&&eq(q.body.password,PASS);
  setTimeout(()=>{if(!ok)return r.status(401).json({error:'Wrong password'});
    const t=crypto.randomBytes(24).toString('hex');db.prepare('DELETE FROM sessions WHERE exp<?').run(Date.now());
    db.prepare('INSERT INTO sessions(h,exp) VALUES(?,?)').run(sha(t),Date.now()+432e5);
    r.set('Set-Cookie',`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${q.secure?'; Secure':''}`).json({ok:1})},ok?0:400)});
app.post('/admin/api/logout',(q,r)=>{const t=sid(q);if(t)db.prepare('DELETE FROM sessions WHERE h=?').run(sha(t));r.set('Set-Cookie','sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').json({ok:1})});
app.get('/admin/api/stats',auth,(q,r)=>r.json({
  orders:db.prepare('SELECT COUNT(*) c FROM orders').get().c,fresh:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='new'").get().c,
  revenue:db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN('confirmed','shipped','delivered')").get().s,
  products:db.prepare('SELECT COUNT(*) c FROM products').get().c,out:db.prepare('SELECT COUNT(*) c FROM products WHERE in_stock=0').get().c}));
app.get('/admin/api/products',auth,(q,r)=>r.json(db.prepare('SELECT * FROM products ORDER BY sort,rowid').all().map(pub)));
const rmImg=img=>{try{if(img&&img.startsWith('/uploads/')&&!db.prepare('SELECT 1 FROM products WHERE img=?').get(img))fs.unlinkSync(path.join(UP,path.basename(img)))}catch(e){}};
const MAGIC={jpeg:b=>b[0]==0xFF&&b[1]==0xD8&&b[2]==0xFF,png:b=>b.slice(0,4).equals(Buffer.from([0x89,0x50,0x4E,0x47])),webp:b=>b.slice(0,4).toString()=='RIFF'&&b.slice(8,12).toString()=='WEBP'};
app.post('/admin/api/products',auth,(q,r)=>{
  const b=q.body||{},name=clean(b.name),category=clean(b.category),price=Math.round(+b.price),cmp=Math.round(+b.compare_at_price)||null,desc=String(b.description||'').slice(0,1500),badge=String(b.badge||'');
  if(name.length<2||name.length>120||category.length<2||category.length>40)return r.status(400).json({error:'Name aur category sahi likhein.'});
  if(!(price>0&&price<=1e7)||(cmp!==null&&!(cmp>0&&cmp<=1e7)))return r.status(400).json({error:'Price 1 se 10,000,000 ke beech honi chahiye.'});
  if(!BADGES.includes(badge))return r.status(400).json({error:'Badge galat hai.'});
  let id=b.id?String(b.id):'',old=null;
  if(id){if(!SLUG.test(id))return r.status(400).json({error:'Bad id'});old=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!old)return r.status(404).json({error:'Product nahi mila.'})}
  else{const base=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'item';id=base;for(let n=2;db.prepare('SELECT 1 FROM products WHERE id=?').get(id);n++)id=base+'-'+n}
  let img=old?old.img:'',oldImg=old&&old.img;
  if(b.imageData){const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.imageData));
    if(!m)return r.status(400).json({error:'Image format galat hai (sirf JPG, PNG, WebP).'});
    const buf=Buffer.from(m[2],'base64');if(buf.length>5*1024*1024||buf.length<100||!MAGIC[m[1]](buf))return r.status(400).json({error:'Image kharab ya 5MB se bari hai.'});
    const f=`${id}-${Date.now()}.${m[1]=='jpeg'?'jpg':m[1]}`;fs.writeFileSync(path.join(UP,f),buf);img='/uploads/'+f}
  const v=[name,category,price,cmp,desc,img,badge,b.in_stock===false?0:1];
  if(old)db.prepare('UPDATE products SET name=?,category=?,price=?,compare_at_price=?,description=?,img=?,badge=?,in_stock=? WHERE id=?').run(...v,id);
  else db.prepare('INSERT INTO products(name,category,price,compare_at_price,description,img,badge,in_stock,id,sort) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...v,id,Date.now()%1e9);
  if(old&&oldImg!==img)rmImg(oldImg);
  r.json({ok:1,id})});
app.delete('/admin/api/products/:id',auth,(q,r)=>{if(!SLUG.test(q.params.id))return r.status(400).json({error:'Bad id'});
  const p=db.prepare('SELECT img FROM products WHERE id=?').get(q.params.id);db.prepare('DELETE FROM products WHERE id=?').run(q.params.id);if(p)rmImg(p.img);r.json({ok:1})});
app.get('/admin/api/orders',auth,(q,r)=>r.json(db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all().map(o=>({...o,items:JSON.parse(o.items)}))));
app.patch('/admin/api/orders/:id',auth,(q,r)=>{
  const id=+q.params.id;if(!Number.isInteger(id)||!['new','confirmed','shipped','delivered','cancelled'].includes((q.body||{}).status))return r.status(400).json({error:'Bad request'});
  if(!db.prepare('UPDATE orders SET status=? WHERE id=?').run(q.body.status,id).changes)return r.status(404).json({error:'Order nahi mila.'});r.json({ok:1})});
// ---- static + fallbacks
app.use('/uploads',express.static(UP,{maxAge:'7d',dotfiles:'ignore',index:false}));
app.use(express.static(path.join(__dirname,'public'),{dotfiles:'ignore'}));
app.get('/admin',(q,r)=>r.sendFile(path.join(__dirname,'public','admin.html')));
app.use('/api',(q,r)=>r.status(404).json({error:'Not found'}));app.use('/admin/api',(q,r)=>r.status(404).json({error:'Not found'}));
app.use((q,r)=>r.status(404).type('text').send('Not found'));
app.use((e,q,r,n)=>{const s=e.status||e.statusCode||500;if(s>=500)console.error(e);r.status(s>=400&&s<500?s:500).json({error:s===413?'Request too large':s<500?'Bad request':'Server error'})}); // never leak stack traces
process.on('unhandledRejection',e=>console.error('Unhandled:',e));
app.listen(PORT,()=>console.log('Jawaahir store running on port '+PORT));
