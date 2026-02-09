require('dotenv').config();

module.exports = {
    jwtSecret: process.env.JWT_SECRET || 'fallback_secret_key',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h'
};
