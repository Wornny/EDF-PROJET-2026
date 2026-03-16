import { useEffect, useRef, useState } from "react";
import "../styles/menu.css";

const DEFAULT_API_HOST = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "localhost";
const DEFAULT_API_PROTOCOL = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${DEFAULT_API_PROTOCOL}//${DEFAULT_API_HOST}:3000`;

const DEVICES = [
	{
		label: "Controleur mobile",
		image: "/Mip10_color.png",
		route: "/CM/1",
	},
	{
		label: "CPO",
		image: "/CP0Color.png",
		route: "/CPO/1",
	},
	{
		label: "Initialisateur",
		image: "/maintenance.png",
		route: null,
	},
	{
		label: "C2",
		image: "/C2capteurColor.png",
		route: "/C2/1",
	},
];

function Menu({ onLogout }) {
	const [currentIndex, setCurrentIndex] = useState(() => {
		const preferred = DEVICES.findIndex((device) => device.label === "CPO");
		return preferred >= 0 ? preferred : 0;
	});
	const [pulseIndex, setPulseIndex] = useState(null);

	const dragStartX = useRef(0);
	const isDragging = useRef(false);
	const isFirstRender = useRef(true);

	useEffect(() => {
		document.body.classList.add("menu-page");
		return () => {
			document.body.classList.remove("menu-page");
		};
	}, []);

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return undefined;
		}

		setPulseIndex(currentIndex);
		const timeout = setTimeout(() => setPulseIndex(null), 550);
		return () => clearTimeout(timeout);
	}, [currentIndex]);

	const currentDevice = DEVICES[currentIndex] || DEVICES[0];

	const move = (delta) => {
		setCurrentIndex((prevIndex) => (prevIndex + delta + DEVICES.length) % DEVICES.length);
	};

	const navigateIfAvailable = (label) => {
		const target = DEVICES.find((device) => device.label === label);
		if (target?.route) {
			window.location.href = target.route;
		}
	};

	const handleDeviceClick = (index) => {
		const isActive = index === currentIndex;
		setCurrentIndex(index);
		if (isActive) {
			navigateIfAvailable(DEVICES[index].label);
		}
	};

	const handleMouseDown = (event) => {
		isDragging.current = true;
		dragStartX.current = event.clientX;
	};

	const handleMouseUp = (event) => {
		if (!isDragging.current) {
			return;
		}

		isDragging.current = false;
		const diff = event.clientX - dragStartX.current;
		if (diff > 30) {
			move(-1);
		}
		if (diff < -30) {
			move(1);
		}
	};

	const handleMouseLeave = () => {
		isDragging.current = false;
	};

	const handleTouchStart = (event) => {
		dragStartX.current = event.touches[0].clientX;
		isDragging.current = true;
	};

	const handleTouchEnd = (event) => {
		if (!isDragging.current) {
			return;
		}

		isDragging.current = false;
		const diff = event.changedTouches[0].clientX - dragStartX.current;
		if (diff > 30) {
			move(-1);
		}
		if (diff < -30) {
			move(1);
		}
	};

	const handleLogout = async () => {
		const token = localStorage.getItem("authToken");

		try {
			await fetch(`${API_BASE_URL}/api/logout`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
			});
		} catch {
			// Ignore logout network error and clear client session anyway.
		} finally {
			localStorage.removeItem("authToken");
			localStorage.removeItem("username");
			if (typeof onLogout === "function") {
				onLogout();
			}
		}
	};

	return (
		<>
			<div className="logout-button">
				<button type="button" className="btn-logout" onClick={handleLogout}>
					Deconnexion
				</button>
			</div>

			<div className="container">
				<img className="logo" src="/EDF%20Logo.png" alt="EDF Logo" />

				<h2 className="title-pill">SELECTIONNER UN APPAREIL</h2>

				<div
					className="carousel-wrapper"
					onMouseDown={handleMouseDown}
					onMouseUp={handleMouseUp}
					onMouseLeave={handleMouseLeave}
					onTouchStart={handleTouchStart}
					onTouchEnd={handleTouchEnd}
				>
					<div className="carousel">
						{DEVICES.map((device, index) => {
							let rel = index - currentIndex;
							if (rel > DEVICES.length / 2) rel -= DEVICES.length;
							if (rel < -DEVICES.length / 2) rel += DEVICES.length;

							let slotClass = "slot-back";
							if (rel === 0) slotClass = "slot-center";
							else if (rel === -1) slotClass = "slot-left";
							else if (rel === 1) slotClass = "slot-right";

							const isBack = rel === 2 || rel === -2;
							const isActive = rel === 0;
							const className = [
								"device",
								slotClass,
								isBack ? "back" : "",
								isActive ? "active" : "side",
								pulseIndex === index ? "pulse" : "",
							]
								.filter(Boolean)
								.join(" ");

							return (
								<div
									key={device.label}
									className={className}
									data-label={device.label}
									tabIndex={0}
									role="button"
									aria-selected={isActive ? "true" : "false"}
									onClick={() => handleDeviceClick(index)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											handleDeviceClick(index);
										}
									}}
								>
									<img src={device.image} alt={device.label} />
									<div className="label">{device.label}</div>
								</div>
							);
						})}
					</div>
				</div>

				<div className="controls">
					<div className="footer-text" id="selected-label">
						{currentDevice.label}
					</div>
				</div>
			</div>
		</>
	);
}

export default Menu;
