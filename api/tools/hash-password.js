// Makes a PORTAL_USERS entry. Usage: node tools/hash-password.js <username> <password> <admin|customer> "<Full name>" [customerNo]
"use strict";
const { hashPassword } = require("../src/lib/session");
const [username, password, role, name, customerNo] = process.argv.slice(2);
if (!username || !password || !role || !name) {
  console.log('Usage: node tools/hash-password.js <username> <password> <admin|customer> "<Full name>" [customerNo]');
  process.exit(1);
}
console.log(JSON.stringify({ username, name, role, customerNo: customerNo || "", active: true, hash: hashPassword(password) }));
