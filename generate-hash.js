const bcrypt = require('bcrypt');

async function generateHash() {
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);
    console.log('Bcrypt hash for "password123":');
    console.log(hash);
    console.log('\nSQL UPDATE statements:');
    console.log(`UPDATE users SET password_hash = '${hash}' WHERE username IN ('admin', 'cmd_north', 'cmd_east', 'log_north', 'log_east');`);
}

generateHash();
