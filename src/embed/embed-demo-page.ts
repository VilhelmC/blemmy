/**
 * Dev/demo page: registers <blemmy-doc> and loads bundled CV JSON via blob URL.
 */
import './blemmy-doc-entry';
import demo from '@data/cv-demo.json';

const host = document.getElementById('blemmy-doc-host');
if (host) {
	const el = document.createElement('blemmy-doc');
	const json = JSON.stringify(demo);
	const blob = new Blob([json], { type: 'application/json' });
	el.setAttribute('src', URL.createObjectURL(blob));
	host.appendChild(el);
}
