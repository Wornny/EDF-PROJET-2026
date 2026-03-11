import { useEffect, useState } from "react";
import "../styles/login.css";

const DEFAULT_API_HOST = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "localhost";
const DEFAULT_API_PROTOCOL = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${DEFAULT_API_PROTOCOL}//${DEFAULT_API_HOST}:3000`;

function Login({ onLoginSuccess }) {
	const [login, setLogin] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [locked, setLocked] = useState(false);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		document.body.classList.add("login-page");
		return () => {
			document.body.classList.remove("login-page");
		};
	}, []);

	const handleSubmit = async (event) => {
		event.preventDefault();
		if (loading || locked) {
			return;
		}

		setLoading(true);
		setError("");

		try {
			const response = await fetch(`${API_BASE_URL}/api/login`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ login, password }),
			});

			const payload = await response.json().catch(() => ({}));

			if (!response.ok) {
				setError(payload.error || "Erreur de connexion.");
				setLocked(Boolean(payload.locked));
				return;
			}

			if (payload.token) {
				localStorage.setItem("authToken", payload.token);
			}
			if (payload.username) {
				localStorage.setItem("username", payload.username);
			}

			setError("");
			setLocked(false);
			if (typeof onLoginSuccess === "function") {
				onLoginSuccess();
			}
		} catch {
			setError("Impossible de contacter le serveur.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="login-container">
			<h2>Connexion</h2>

			{error ? <p style={{ color: "red" }}>{error}</p> : null}

			<form onSubmit={handleSubmit}>
				<div className="form-group">
					<label htmlFor="login">Identifiant :</label>
					<input
						id="login"
						type="text"
						name="login"
						value={login}
						onChange={(event) => setLogin(event.target.value)}
						required
						disabled={locked}
					/>
				</div>

				<div className="form-group">
					<label htmlFor="password">Mot de passe :</label>
					<input
						id="password"
						type="password"
						name="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
						disabled={locked}
					/>
				</div>

				<button type="submit" disabled={locked || loading}>
					{loading ? "Connexion..." : "Se connecter"}
				</button>
			</form>
		</div>
	);
}

export default Login;
