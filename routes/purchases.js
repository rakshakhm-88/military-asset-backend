const express = require('express');
const db = require('../config/database');
const authenticateToken = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logAction } = require('../utils/logger');

const router = express.Router();

router.post('/', authenticateToken, requireRole('admin', 'logistics_officer'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { base_id, asset_id, quantity, unit_price, supplier_name, purchase_order_number, purchase_date, notes } = req.body;

        if (!base_id || !asset_id || !quantity || !purchase_date) {
            return res.status(400).json({ error: 'base_id, asset_id, quantity, and purchase_date are required.' });
        }

        if (req.user.role !== 'admin' && parseInt(base_id) !== req.user.base_id) {
            return res.status(403).json({ error: 'You can only create purchases for your assigned base.' });
        }

        await connection.beginTransaction();

        const total_price = unit_price ? parseFloat(unit_price) * parseFloat(quantity) : null;

        const [result] = await connection.execute(
            `INSERT INTO purchases (base_id, asset_id, quantity, unit_price, total_price, supplier_name, 
        purchase_order_number, purchase_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [base_id, asset_id, quantity, unit_price, total_price, supplier_name, purchase_order_number,
                purchase_date, notes, req.user.id]
        );

        await connection.execute(
            `INSERT INTO inventory (base_id, asset_id, current_quantity, closing_balance)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         current_quantity = current_quantity + ?,
         closing_balance = closing_balance + ?`,
            [base_id, asset_id, quantity, quantity, quantity, quantity]
        );

        await connection.commit();

        await logAction(req.user.id, 'CREATE_PURCHASE', 'purchase', result.insertId,
            { base_id, asset_id, quantity, purchase_date }, req.ip);

        res.status(201).json({
            message: 'Purchase recorded successfully.',
            purchase_id: result.insertId
        });
    } catch (error) {
        await connection.rollback();
        console.error('Purchase creation error:', error);
        res.status(500).json({ error: 'Failed to record purchase.' });
    } finally {
        connection.release();
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { base_id, asset_id, start_date, end_date } = req.query;

        let filters = [];
        let params = [];

        if (req.user.role !== 'admin') {
            filters.push('p.base_id = ?');
            params.push(req.user.base_id);
        } else if (base_id) {
            filters.push('p.base_id = ?');
            params.push(base_id);
        }

        if (asset_id) {
            filters.push('p.asset_id = ?');
            params.push(asset_id);
        }

        if (start_date) {
            filters.push('p.purchase_date >= ?');
            params.push(start_date);
        }

        if (end_date) {
            filters.push('p.purchase_date <= ?');
            params.push(end_date);
        }

        const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

        const [purchases] = await db.execute(
            `SELECT p.*, b.base_name, a.asset_name, a.category, u.full_name as created_by_name
       FROM purchases p
       JOIN bases b ON p.base_id = b.id
       JOIN assets a ON p.asset_id = a.id
       JOIN users u ON p.created_by = u.id
       ${whereClause}
       ORDER BY p.purchase_date DESC, p.created_at DESC`,
            params
        );

        res.json({ purchases });
    } catch (error) {
        console.error('Get purchases error:', error);
        res.status(500).json({ error: 'Failed to retrieve purchases.' });
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const [purchases] = await db.execute(
            `SELECT p.*, b.base_name, a.asset_name, a.category, u.full_name as created_by_name
       FROM purchases p
       JOIN bases b ON p.base_id = b.id
       JOIN assets a ON p.asset_id = a.id
       JOIN users u ON p.created_by = u.id
       WHERE p.id = ?`,
            [req.params.id]
        );

        if (purchases.length === 0) {
            return res.status(404).json({ error: 'Purchase not found.' });
        }

        if (req.user.role !== 'admin' && purchases[0].base_id !== req.user.base_id) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        res.json({ purchase: purchases[0] });
    } catch (error) {
        console.error('Get purchase error:', error);
        res.status(500).json({ error: 'Failed to retrieve purchase.' });
    }
});

module.exports = router;
