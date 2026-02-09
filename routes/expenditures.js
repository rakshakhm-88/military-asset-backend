const express = require('express');
const db = require('../config/database');
const authenticateToken = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logAction } = require('../utils/logger');

const router = express.Router();

router.post('/', authenticateToken, requireRole('admin', 'base_commander'), async (req, res) => {
    try {
        const { base_id, asset_id, assignment_id, quantity, expenditure_date, reason,
            operation_name, authorized_by } = req.body;

        if (!base_id || !asset_id || !quantity || !expenditure_date || !reason) {
            return res.status(400).json({
                error: 'base_id, asset_id, quantity, expenditure_date, and reason are required.'
            });
        }

        if (req.user.role !== 'admin' && parseInt(base_id) !== req.user.base_id) {
            return res.status(403).json({ error: 'You can only record expenditures for your assigned base.' });
        }

        const [result] = await db.execute(
            `INSERT INTO expenditures (base_id, asset_id, assignment_id, quantity, expenditure_date,
        reason, operation_name, authorized_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [base_id, asset_id, assignment_id, quantity, expenditure_date, reason,
                operation_name, authorized_by, req.user.id]
        );

        if (assignment_id) {
            await db.execute(
                `UPDATE assignments SET status = 'expended' WHERE id = ?`,
                [assignment_id]
            );
        }

        await logAction(req.user.id, 'CREATE_EXPENDITURE', 'expenditure', result.insertId,
            { base_id, asset_id, quantity, reason }, req.ip);

        res.status(201).json({
            message: 'Expenditure recorded successfully.',
            expenditure_id: result.insertId
        });
    } catch (error) {
        console.error('Expenditure creation error:', error);
        res.status(500).json({ error: 'Failed to record expenditure.' });
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { base_id, asset_id, operation, start_date, end_date } = req.query;

        let filters = [];
        let params = [];

        if (req.user.role !== 'admin') {
            filters.push('e.base_id = ?');
            params.push(req.user.base_id);
        } else if (base_id) {
            filters.push('e.base_id = ?');
            params.push(base_id);
        }

        if (asset_id) {
            filters.push('e.asset_id = ?');
            params.push(asset_id);
        }

        if (operation) {
            filters.push('e.operation_name LIKE ?');
            params.push(`%${operation}%`);
        }

        if (start_date) {
            filters.push('e.expenditure_date >= ?');
            params.push(start_date);
        }

        if (end_date) {
            filters.push('e.expenditure_date <= ?');
            params.push(end_date);
        }

        const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

        const [expenditures] = await db.execute(
            `SELECT e.*, b.base_name, a.asset_name, a.category, 
         asn.assigned_to_personnel, asn.assigned_to_unit,
         u.full_name as created_by_name
       FROM expenditures e
       JOIN bases b ON e.base_id = b.id
       JOIN assets a ON e.asset_id = a.id
       LEFT JOIN assignments asn ON e.assignment_id = asn.id
       JOIN users u ON e.created_by = u.id
       ${whereClause}
       ORDER BY e.expenditure_date DESC, e.created_at DESC`,
            params
        );

        res.json({ expenditures });
    } catch (error) {
        console.error('Get expenditures error:', error);
        res.status(500).json({ error: 'Failed to retrieve expenditures.' });
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const [expenditures] = await db.execute(
            `SELECT e.*, b.base_name, a.asset_name, a.category,
         asn.assigned_to_personnel, asn.assigned_to_unit,
         u.full_name as created_by_name
       FROM expenditures e
       JOIN bases b ON e.base_id = b.id
       JOIN assets a ON e.asset_id = a.id
       LEFT JOIN assignments asn ON e.assignment_id = asn.id
       JOIN users u ON e.created_by = u.id
       WHERE e.id = ?`,
            [req.params.id]
        );

        if (expenditures.length === 0) {
            return res.status(404).json({ error: 'Expenditure not found.' });
        }

        if (req.user.role !== 'admin' && expenditures[0].base_id !== req.user.base_id) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        res.json({ expenditure: expenditures[0] });
    } catch (error) {
        console.error('Get expenditure error:', error);
        res.status(500).json({ error: 'Failed to retrieve expenditure.' });
    }
});

module.exports = router;
