/** État de connexion, réactif. */
class Net {
	online = $state(true);

	init() {
		if (typeof navigator === 'undefined') return;
		this.online = navigator.onLine;
		addEventListener('online', () => (this.online = true));
		addEventListener('offline', () => (this.online = false));
	}
}

export const net = new Net();
