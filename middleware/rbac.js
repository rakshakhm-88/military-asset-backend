const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
        }

        next();
    };
};

const requireBaseAccess = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.user.role === 'admin') {
        return next();
    }

    const requestedBaseId = parseInt(req.params.baseId || req.body.base_id || req.query.base_id);

    if (req.user.role === 'base_commander' || req.user.role === 'logistics_officer') {
        if (!req.user.base_id) {
            return res.status(403).json({ error: 'User not assigned to any base.' });
        }

        if (requestedBaseId && requestedBaseId !== req.user.base_id) {
            return res.status(403).json({ error: 'Access denied. You can only access your assigned base.' });
        }
    }

    next();
};

module.exports = { requireRole, requireBaseAccess };
