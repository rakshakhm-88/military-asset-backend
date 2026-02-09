const express = require('express');
const db = require('../config/database');
const authenticateToken = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logAction } = require('../utils/logger');

const router = express.Router();

router.post('/', authenticateToken, requireRole('admin', 'base_commander', 'logistics_officer'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { base_id, asset_id, quantity, assigned_to_personnel, assigned_to_unit,
            assignment_date, purpose } = req.body;

        if (!base_id || !asset_id || !quantity || !assigned_to_personnel || !assignment_date) {
            return res.status(400).json({
                error: 'base_id, asset_id, quantity, assigned_to_personnel, and assignment_date are required.'
            });
        }

        if (req.user.role !== 'admin' && parseInt(base_id) !== req.user.base_id) {
            return res.status(403).json({ error: 'You can only create assignments for your assigned base.' });
        }

        await connection.beginTransaction();

        const [inventory] = await connection.execute(
            'SELECT current_quantity FROM inventory WHERE base_id = ? AND asset_id = ?',
            [base_id, asset_id]
        );

        if (inventory.length === 0 || parseFloat(inventory[0].current_quantity) < parseFloat(quantity)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Insufficient quantity available for assignment.' });
        }

        const [result] = await connection.execute(
            `INSERT INTO assignments (base_id, asset_id, quantity, assigned_to_personnel, assigned_to_unit,
        assignment_date, purpose, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
            [base_id, asset_id, quantity, assigned_to_personnel, assigned_to_unit,
                assignment_date, purpose, req.user.id]
        );

        await connection.execute(
            `UPDATE inventory SET current_quantity = current_quantity - ?
       WHERE base_id = ? AND asset_id = ?`,
            [quantity, base_id, asset_id]
        );

        await connection.commit();

        await logAction(req.user.id, 'CREATE_ASSIGNMENT', 'assignment', result.insertId,
            { base_id, asset_id, quantity, assigned_to_personnel }, req.ip);

        res.status(201).json({
            message: 'Assignment created successfully.',
            assignment_id: result.insertId
        });
    } catch (error) {
        await connection.rollback();
        console.error('Assignment creation error:', error);
        res.status(500).json({ error: 'Failed to create assignment.' });
    } finally {
        connection.release();
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { base_id, asset_id, personnel, status } = req.query;

        let filters = [];
        let params = [];

        if (req.user.role !== 'admin') {
            filters.push('asn.base_id = ?');
            params.push(req.user.base_id);
        } else if (base_id) {
            filters.push('asn.base_id = ?');
            params.push(base_id);
        }

        if (asset_id) {
            filters.push('asn.asset_id = ?');
            params.push(asset_id);
        }

        if (personnel) {
            filters.push('asn.assigned_to_personnel LIKE ?');
            params.push(`%${personnel}%`);
        }

        if (status) {
            filters.push('asn.status = ?');
            params.push(status);
        }

        const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

        const [assignments] = await db.execute(
            `SELECT asn.*, b.base_name, a.asset_name, a.category, u.full_name as created_by_name
       FROM assignments asn
       JOIN bases b ON asn.base_id = b.id
       JOIN assets a ON asn.asset_id = a.id
       JOIN users u ON asn.created_by = u.id
       ${whereClause}
       ORDER BY asn.assignment_date DESC, asn.created_at DESC`,
            params
        );

        res.json({ assignments });
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Failed to retrieve assignments.' });
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const [assignments] = await db.execute(
            `SELECT asn.*, b.base_name, a.asset_name, a.category, u.full_name as created_by_name
       FROM assignments asn
       JOIN bases b ON asn.base_id = b.id
       JOIN assets a ON asn.asset_id = a.id
       JOIN users u ON asn.created_by = u.id
       WHERE asn.id = ?`,
            [req.params.id]
        );

        if (assignments.length === 0) {
            return res.status(404).json({ error: 'Assignment not found.' });
        }

        if (req.user.role !== 'admin' && assignments[0].base_id !== req.user.base_id) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        res.json({ assignment: assignments[0] });
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({ error: 'Failed to retrieve assignment.' });
    }
});

module.exports = router;
