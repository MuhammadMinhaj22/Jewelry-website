# Jawaahir Jewelry Store (Node.js 22.5+ / SQLite)

## Zaroori environment variables (.env file NAHI padhi jati, hosting panel ya terminal mein set karein)
- ADMIN_PASSWORD  (zaroori, kam az kam 10 characters. Kamzor ya khali ho to server start hi nahi hota)
- WHATSAPP        (optional, digits only, default 923116052491)
- PORT, DB_PATH, UPLOAD_DIR, TRUST_PROXY (optional)

## Local chalana
Windows cmd:  set ADMIN_PASSWORD=MeraMazbootPass2026&& npm start
Store: http://localhost:3000   Admin: http://localhost:3000/admin

## cPanel (GoDaddy) par
- App folder public_html ke BAHAR rakhein (jaise /home/user/jawaahir). Isko public_html ke andar kabhi na rakhein.
- Setup Node.js App: Node 22.5+ (24 behtar), Production, startup file server.js
- Environment variables mein ADMIN_PASSWORD set karein, phir Run NPM Install aur Restart.
- SSL (AutoSSL) lagayein aur HTTPS redirect on karein.

## Cloudflare Pages (static catalog)
- Build command: `npm run build`; build output directory: `public`.
- Build creates `/api/products.js` and copies the seed catalog images to `/images/`, which Pages can serve as static assets.
- Pages only serves this static catalog. Checkout/order APIs, admin APIs, and uploaded product images require a running Node.js backend; deploying this project to Pages alone does not run `server.js`.

## Security notes
- Prices aur total hamesha server database se nikalte hain. Client ki bheji price ignore hoti hai.
- Admin login: 8 koshish / 15 minute / IP. Session 12 ghante, database mein, logout par khatam.
- Order: 10 / ghanta / IP. Images: sirf JPG/PNG/WebP, 5MB tak, file ka asli format check hota hai.
- Backup: data/shop.db aur public/uploads ki copy har hafte lein.
