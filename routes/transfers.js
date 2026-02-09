const express = require('express');
const db = require('../config/database');
const authenticateToken = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logAction } = require('../utils/logger');

const router = express.Router();

router.post('/', authenticateToken, requireRole('admin', 'logistics_officer'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { source_base_id, destination_base_id, asset_id, quantity, transfer_date,
            transfer_order_number, reason } = req.body;

        if (!source_base_id || !destination_base_id || !asset_id || !quantity || !transfer_date) {
            return res.status(400).json({
                error: 'source_base_id, destination_base_id, asset_id, quantity, and transfer_date are required.'
            });
        }

        if (source_base_id === destination_base_id) {
            return res.status(400).json({ error: 'Source and destination bases must be different.' });
        }

        if (req.user.role !== 'admin' &&
            parseInt(source_base_id) !== req.user.base_id &&
            parseInt(destination_base_id) !== req.user.base_id) {
            return res.status(403).json({ error: 'You can only create transfers involving your assigned base.' });
        }

        await connection.beginTransaction();

        const [inventory] = await connection.execute(
            'SELECT current_quantity FROM inventory WHERE base_id = ? AND asset_id = ?',
            [source_base_id, asset_id]
        );

        if (inventory.length === 0 || parseFloat(inventory[0].current_quantity) < parseFloat(quantity)) {
            await connection.rollback();
            return res.status(400).json({ error: 'Insufficient quantity at source base.' });
        }

        const [result] = await connection.execute(
            `INSERT INTO transfers (source_base_id, destination_base_id, asset_id, quantity, 
        transfer_date, transfer_order_number, reason, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
            [source_base_id, destination_base_id, asset_id, quantity, transfer_date,
                transfer_order_number, reason, req.user.id]
        );

        await connection.execute(
            `UPDATE inventory SET current_quantity = current_quantity - ?, closing_balance = closing_balance - ?
       WHERE base_id = ? AND asset_id = ?`,
            [quantity, quantity, source_base_id, asset_id]
        );

        await connection.execute(
            `INSERT INTO inventory (base_id, asset_id, current_quantity, closing_balance)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         current_quantity = current_quantity + ?,
         closing_balance = closing_balance + ?`,
            [destination_base_id, asset_id, quantity, quantity, quantity, quantity]
        );

        await connection.commit();

        await logAction(req.user.id, 'CREATE_TRANSFER', 'transfer', result.insertId,
            { source_base_id, destination_base_id, asset_id, quantity }, req.ip);

        res.status(201).json({
            message: 'Transfer completed successfully.',
            transfer_id: result.insertId
        });
    } catch (error) {
        await connection.rollback();
        console.error('Transfer creation error:', error);
        res.status(500).json({ error: 'Failed to create transfer.' });
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
            filters.push('(t.source_base_id = ? OR t.destination_base_id = ?)');
            params.push(req.user.base_id, req.user.base_id);
        } else if (base_id) {
            filters.push('(t.source_base_id = ? OR t.destination_base_id = ?)');
            params.push(base_id, base_id);
        }

        if (asset_id) {
            filters.push('t.asset_id = ?');
            params.push(asset_id);
        }

        if (start_date) {
            filters.push('t.transfer_date >= ?');
            params.push(start_date);
        }

        if (end_date) {
            filters.push('t.transfer_date <= ?');
            params.push(end_date);
        }

        const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

        const [transfers] = await db.execute(
            `SELECT t.*, 
         sb.base_name as source_base_name,
         db.base_name as destination_base_name,
         a.asset_name, a.category,
         u.full_name as created_by_name
       FROM transfers t
       JOIN bases sb ON t.source_base_id = sb.id
       JOIN bases db ON t.destination_base_id = db.id
       JOIN assets a ON t.asset_id = a.id
       JOIN users u ON t.created_by = u.id
       ${whereClause}
       ORDER BY t.transfer_date DESC, t.created_at DESC`,
            params
        );

        res.json({ transfers });
    } catch (error) {
        console.error('Get transfers error:', error);
        res.status(500).json({ error: 'Failed to retrieve transfers.' });
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const [transfers] = await db.execute(
            `SELECT t.*, 
         sb.base_name as source_base_name,
         db.base_name as destination_base_name,
         a.asset_name, a.category,
         u.full_name as created_by_name
       FROM transfers t
       JOIN bases sb ON t.source_base_id = sb.id
       JOIN bases db ON t.destination_base_id = db.id
       JOIN assets a ON t.asset_id = a.id
       JOIN users u ON t.created_by = u.id
       WHERE t.id = ?`,
            [req.params.id]
        );

        if (transfers.length === 0) {
            return res.status(404).json({ error: 'Transfer not found.' });
        }

        const transfer = transfers[0];
        if (req.user.role !== 'admin' &&
            transfer.source_base_id !== req.user.base_id &&
            transfer.destination_base_id !== req.user.base_id) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        res.json({ transfer });
    } catch (error) {
        console.error('Get transfer error:', error);
        res.status(500).json({ error: 'Failed to retrieve transfer.' });
    }
});

module.exports = router;
