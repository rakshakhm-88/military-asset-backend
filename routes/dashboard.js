const express = require('express');
const db = require('../config/database');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { start_date, end_date, base_id, asset_id } = req.query;

        let baseFilter = '';
        const params = [];

        if (req.user.role !== 'admin') {
            baseFilter = 'AND i.base_id = ?';
            params.push(req.user.base_id);
        } else if (base_id) {
            baseFilter = 'AND i.base_id = ?';
            params.push(base_id);
        }

        let assetFilter = '';
        if (asset_id) {
            assetFilter = 'AND i.asset_id = ?';
            params.push(asset_id);
        }

        const query = `
      SELECT 
        i.id,
        b.base_name,
        b.id as base_id,
        a.asset_name,
        a.id as asset_id,
        a.category,
        a.unit_of_measure,
        i.opening_balance,
        i.current_quantity,
        i.closing_balance,
        COALESCE(SUM(p.quantity), 0) as total_purchases,
        COALESCE(SUM(CASE WHEN t.destination_base_id = i.base_id THEN t.quantity ELSE 0 END), 0) as transfers_in,
        COALESCE(SUM(CASE WHEN t.source_base_id = i.base_id THEN t.quantity ELSE 0 END), 0) as transfers_out,
        COALESCE(SUM(asn.quantity), 0) as total_assigned,
        COALESCE(SUM(e.quantity), 0) as total_expended
      FROM inventory i
      JOIN bases b ON i.base_id = b.id
      JOIN assets a ON i.asset_id = a.id
      LEFT JOIN purchases p ON p.base_id = i.base_id AND p.asset_id = i.asset_id
        ${start_date ? 'AND p.purchase_date >= ?' : ''}
        ${end_date ? 'AND p.purchase_date <= ?' : ''}
      LEFT JOIN transfers t ON (t.source_base_id = i.base_id OR t.destination_base_id = i.base_id) 
        AND t.asset_id = i.asset_id AND t.status = 'completed'
        ${start_date ? 'AND t.transfer_date >= ?' : ''}
        ${end_date ? 'AND t.transfer_date <= ?' : ''}
      LEFT JOIN assignments asn ON asn.base_id = i.base_id AND asn.asset_id = i.asset_id
        ${start_date ? 'AND asn.assignment_date >= ?' : ''}
        ${end_date ? 'AND asn.assignment_date <= ?' : ''}
      LEFT JOIN expenditures e ON e.base_id = i.base_id AND e.asset_id = i.asset_id
        ${start_date ? 'AND e.expenditure_date >= ?' : ''}
        ${end_date ? 'AND e.expenditure_date <= ?' : ''}
      WHERE 1=1 ${baseFilter} ${assetFilter}
      GROUP BY i.id, b.base_name, b.id, a.asset_name, a.id, a.category, a.unit_of_measure, 
               i.opening_balance, i.current_quantity, i.closing_balance
    `;

        if (start_date) {
            params.push(start_date, start_date, start_date, start_date);
        }
        if (end_date) {
            params.push(end_date, end_date, end_date, end_date);
        }

        const [results] = await db.execute(query, params);

        const dashboard = results.map(row => ({
            ...row,
            net_movement: parseFloat(row.total_purchases) + parseFloat(row.transfers_in) - parseFloat(row.transfers_out)
        }));

        res.json({ dashboard });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to retrieve dashboard data.' });
    }
});

router.get('/movement-breakdown', authenticateToken, async (req, res) => {
    try {
        const { base_id, asset_id, start_date, end_date } = req.query;

        if (!base_id || !asset_id) {
            return res.status(400).json({ error: 'base_id and asset_id are required.' });
        }

        if (req.user.role !== 'admin' && parseInt(base_id) !== req.user.base_id) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const params = [base_id, asset_id];
        let dateFilter = '';

        if (start_date && end_date) {
            dateFilter = 'AND purchase_date BETWEEN ? AND ?';
            params.push(start_date, end_date);
        }

        const [purchases] = await db.execute(
            `SELECT COALESCE(SUM(quantity), 0) as total FROM purchases 
       WHERE base_id = ? AND asset_id = ? ${dateFilter}`,
            params
        );

        const transferParams = [base_id, asset_id];
        let transferDateFilter = '';
        if (start_date && end_date) {
            transferDateFilter = 'AND transfer_date BETWEEN ? AND ?';
            transferParams.push(start_date, end_date);
        }

        const [transfersIn] = await db.execute(
            `SELECT COALESCE(SUM(quantity), 0) as total FROM transfers 
       WHERE destination_base_id = ? AND asset_id = ? AND status = 'completed' ${transferDateFilter}`,
            transferParams
        );

        const [transfersOut] = await db.execute(
            `SELECT COALESCE(SUM(quantity), 0) as total FROM transfers 
       WHERE source_base_id = ? AND asset_id = ? AND status = 'completed' ${transferDateFilter}`,
            transferParams
        );

        const breakdown = {
            purchases: parseFloat(purchases[0].total),
            transfers_in: parseFloat(transfersIn[0].total),
            transfers_out: parseFloat(transfersOut[0].total),
            net_movement: parseFloat(purchases[0].total) + parseFloat(transfersIn[0].total) - parseFloat(transfersOut[0].total)
        };

        res.json({ breakdown });
    } catch (error) {
        console.error('Movement breakdown error:', error);
        res.status(500).json({ error: 'Failed to retrieve movement breakdown.' });
    }
});

module.exports = router;
