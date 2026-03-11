const crypto = require("crypto");

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function formatRemaining(ms) {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes <= 0) {
		return `${seconds} sec`;
	}
	return `${minutes} min ${String(seconds).padStart(2, "0")} sec`;
}

function createLoginController({ sessions, loginLocks, authenticateUser, parseAuthToken, getClientKey }) {
	if (!sessions || typeof sessions.set !== "function") {
		throw new Error("sessions map is required");
	}
	if (!loginLocks || typeof loginLocks.set !== "function") {
		throw new Error("loginLocks map is required");
	}
	if (typeof authenticateUser !== "function") {
		throw new Error("authenticateUser function is required");
	}
	if (typeof parseAuthToken !== "function") {
		throw new Error("parseAuthToken function is required");
	}
	if (typeof getClientKey !== "function") {
		throw new Error("getClientKey function is required");
	}

	return {
		login: async (req, res) => {
			const username = String(req.body.login || req.body.username || "").trim();
			const password = String(req.body.password || "");
			const clientKey = getClientKey(req);

			const now = Date.now();
			const lock = loginLocks.get(clientKey);
			if (lock && lock.lockUntil > now) {
				const remaining = lock.lockUntil - now;
				return res.status(429).json({
					ok: false,
					error: `Trop de tentatives echouees. Reessaie dans ${formatRemaining(remaining)}.`,
					locked: true,
				});
			}

			const authenticated = await authenticateUser(username, password);
			if (!authenticated) {
				const nextAttempts = (lock?.attempts || 0) + 1;
				const next = { attempts: nextAttempts, lockUntil: 0 };
				if (nextAttempts >= MAX_LOGIN_ATTEMPTS) {
					next.lockUntil = now + LOCK_DURATION_MS;
				}
				loginLocks.set(clientKey, next);

				if (next.lockUntil > now) {
					return res.status(429).json({
						ok: false,
						error: `Trop de tentatives echouees. Reessaie dans ${formatRemaining(next.lockUntil - now)}.`,
						locked: true,
					});
				}

				const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - nextAttempts);
				return res.status(401).json({
					ok: false,
					error: `Identifiant ou mot de passe incorrect, il vous reste ${remaining} tentative(s).`,
					locked: false,
				});
			}

			loginLocks.delete(clientKey);
			const token = crypto.randomUUID();
			sessions.set(token, {
				isAuthenticated: true,
				username,
				createdAt: now,
				lastSeenAt: now,
			});

			return res.json({ ok: true, token, username });
		},

		logout: (req, res) => {
			const token = parseAuthToken(req);
			if (token) {
				sessions.delete(token);
			}
			return res.json({ ok: true });
		},
	};
}

module.exports = {
	createLoginController,
};
