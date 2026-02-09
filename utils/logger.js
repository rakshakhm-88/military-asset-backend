const db = require('../config/database');

const logAction = async (userId, action, entityType, entityId, details, ipAddress = null) => {
    try {
        const query = `
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

        const detailsJson = JSON.stringify(details);
        await db.execute(query, [userId, action, entityType, entityId, detailsJson, ipAddress]);
    } catch (error) {
        console.error('Audit logging failed:', error);
    }
};

module.exports = { logAction };
