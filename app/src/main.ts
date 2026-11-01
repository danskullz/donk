import { mount } from 'svelte';
// Latin subset only: callout names and blurbs are English, and the offline pack stays small.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';
import './styles/session.css';
import App from './App.svelte';
import './app/register-sw'; // offline: registers the service worker in production builds only

const target = document.getElementById('app');
if (!target) throw new Error('#app missing from index.html');

export default mount(App, { target });
