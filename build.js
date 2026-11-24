const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const products = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'products.json'), 'utf8'));
const imageDir = path.join(root, 'public', 'images');
const apiDir = path.join(root, 'public', 'api');

fs.mkdirSync(imageDir, { recursive: true });
fs.mkdirSync(apiDir, { recursive: true });

const publicProducts = products
  .filter(product => product.in_stock !== 'no')
  .map(product => {
    if (path.basename(product.image) !== product.image) {
      throw new Error(`Invalid image filename in seed data: ${product.image}`);
    }
    fs.copyFileSync(
      path.join(root, 'seed', 'images', product.image),
      path.join(imageDir, product.image)
    );
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      compare_at_price: product.compare_at_price || null,
      description: product.description || '',
      img: `/images/${product.image}`,
      badge: product.badge || '',
      in_stock: true
    };
  });

const whatsapp = process.env.WHATSAPP || '923116052491';
const script = `const WA_NUM=${JSON.stringify(whatsapp)};const P=${JSON.stringify(publicProducts).replace(/</g, '\\u003c')};\n`;
fs.writeFileSync(path.join(apiDir, 'products.js'), script);
console.log(`Built static catalog: ${publicProducts.length} products, ${publicProducts.length} images`);
