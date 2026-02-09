const express = require('express');
const db = require('../config/database');
const authenticateToken = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { user_id, action, entity_type, start_date, end_date, limit = 100 } = req.query;

        let filters = [];
        let params = [];

        if (user_id) {
            filters.push('al.user_id = ?');
            params.push(user_id);
        }

        if (action) {
            filters.push('al.action = ?');
            params.push(action);
        }

        if (entity_type) {
            filters.push('al.entity_type = ?');
            params.push(entity_type);
        }

        if (start_date) {
            filters.push('al.created_at >= ?');
            params.push(start_date);
        }

        if (end_date) {
            filters.push('al.created_at <= ?');
            params.push(end_date);
        }

        const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';
        // params.push(parseInt(limit)); // Removed because LIMIT ? caused ER_WRONG_ARGUMENTS

        const [logs] = await db.execute(
            `SELECT al.*, u.username, u.full_name
       FROM audit_logs al
       JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ${parseInt(limit)}`,
            params
        );

        res.json({ logs });
    } catch (error) {
        console.error('Get audit logs error:', error);
        res.status(500).json({ error: 'Failed to retrieve audit logs.' });
    }
});

module.exports = router;
