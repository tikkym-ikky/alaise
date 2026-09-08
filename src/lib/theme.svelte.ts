export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'alaise.theme';
const ORDER: Theme[] = ['auto', 'light', 'dark'];

export const THEME_LABEL: Record<Theme, string> = {
	auto: 'Thème : système',
	light: 'Thème : clair',
	dark: 'Thème : sombre'
};

class ThemeStore {
	value = $state<Theme>('auto');
	/** Ce qui est réellement affiché, une fois « auto » résolu. */
	isDark = $state(false);

	init() {
		try {
			const saved = localStorage.getItem(KEY) as Theme | null;
			if (saved && ORDER.includes(saved)) this.value = saved;
		} catch {
			// stockage indisponible : on reste sur « auto »
		}
		this.apply();
		window
			.matchMedia('(prefers-color-scheme: dark)')
			.addEventListener('change', () => this.value === 'auto' && this.apply());
	}

	cycle() {
		this.value = ORDER[(ORDER.indexOf(this.value) + 1) % ORDER.length];
		try {
			localStorage.setItem(KEY, this.value);
		} catch {
			// tant pis, le choix ne survivra pas au rechargement
		}
		this.apply();
	}

	private apply() {
		const root = document.documentElement;
		if (this.value === 'auto') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', this.value);

		this.isDark =
			this.value === 'dark' ||
			(this.value === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	}
}

export const theme = new ThemeStore();
