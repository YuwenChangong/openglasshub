const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
<circle cx="32" cy="32" r="30" fill="#2563eb"/>
<text x="32" y="42" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">G</text>
</svg>`;

fs.writeFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), svg);
console.log('favicon.svg created successfully');