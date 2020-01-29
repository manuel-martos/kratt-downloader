const fs = require('fs');
const Nick = require('nickjs');
const nick = new Nick();
const https = require('https');

const url = "https://www.ccma.cat/tv3/super3/germans-kratt/videos/";

var requestId;
var videoUrl;

function getPromise(filename, urlValue) {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(filename);
		https.get(urlValue, (response) => {
			response.pipe(file);
			response.on('end', () => {
				resolve(true);
			});	
		});
	});
}

// async function to make http request
async function makeSynchronousRequest(filename, urlValue) {
	try {
		let http_promise = getPromise(filename, urlValue);
		let response_body = await http_promise;
	}
	catch(error) {
		// Promise rejected
		console.log(error);
	}
}

async function acceptCookies(tab) {
	console.log("Try to accept cookies...");
	await tab.waitUntilVisible('.qc-cmp-button:nth-child(2)');
	await tab.click('.qc-cmp-button:nth-child(2)');
}

async function obtainCurrentVideos(tab) {
	console.log("Obtain the current videos...");
	return await tab.evaluate((arg, callback) => {
		// Here we're in the page context. It's like being in your browser's inspector tool
		const data = [];
		const mediaObjects = document.getElementsByClassName('media-object');
		if (mediaObjects !== undefined) {
			for (mediaObject of mediaObjects) {
				const textElements = mediaObject.getElementsByClassName('txt');
				if (textElements !== undefined && textElements.length === 1) {
					const title = textElements[0].getElementsByTagName('h2');
					if (title !== undefined && title.length === 1) {
						data.push(title[0].innerText);
					}
				}
			}
		}
		callback(null, data)
	});
}

function checkRequiredVideos(currentVideos) {
	console.log(`Check which videos should be downloaded...`);
	const requiredVideos = [];
	for (title of currentVideos) {
		const path = `./${title}.mp4`;
		if (!fs.existsSync(path)) {
			requiredVideos.push(title);
		}
	}
	return requiredVideos;
}

async function injectNetworkInspector(tab) {
	console.log(`Inject network inspector...`);
	await tab.driver.client.send('Network.enable');
	await tab.driver.client.send('Network.setRequestInterception', {
		patterns: [{ urlPattern: '*' }],
	});
	await tab.driver.client.on('Network.requestIntercepted', async e => {
		if (e.request.url.includes('media.jsp?media=')) {
			requestId = e.requestId;
		}
		await tab.driver.client.send('Network.continueInterceptedRequest', {
			interceptionId: e.interceptionId,
		});
	});
	await tab.driver.client.on('Network.responseReceived', async e => {
		if (e.response.url.includes('media.jsp?media=')) {
			let body = await tab.driver.client.Network.getResponseBody({requestId});
			let obj = JSON.parse(body.body);
			for (mediaUrl of obj.media.url) {
				if (mediaUrl.label.includes('720p')) {
					videoUrl = mediaUrl.file;
				}
			}
		}
	});
}

;(async () => {
	try {
		const tab = await nick.newTab()
		var downloadMore = false;
		var needAcceptCookies = true;
		do {
			await tab.open(url)
			if (needAcceptCookies) {
				await acceptCookies(tab);
				needAcceptCookies = false;
			}
			const currentVideos = await obtainCurrentVideos(tab);
			const requiredVideos = checkRequiredVideos(currentVideos);
			if (requiredVideos.length > 0) {
				await injectNetworkInspector(tab);

				// Navigate to first video
				console.log(`Navigate to "${requiredVideos[0]}" video...`);
				await tab.evaluate((args, callback) => {
					document.getElementsByClassName('media-object')[0].click();
					callback(null, true);
				})
				await tab.waitUntilVisible('#view19 > div.jw-wrapper.jw-reset > div.jw-controls.jw-reset > div.jw-display.jw-reset > div > div > div.jw-display-icon-container.jw-display-icon-display.jw-reset > div', 20000);
	
				// Download file
				console.log(`Download "${requiredVideos[0]}" file...`);
				const filename = `${requiredVideos[0]}.mp4`;
				await makeSynchronousRequest(filename, videoUrl);
				downloadMore = requiredVideos.length > 1;
			}
		} while (downloadMore);
	} catch(err) {
		console.log("Could not open page:", err)
	}
})()
.then(() => {
	console.log("Job done!")
	nick.exit()
})
.catch((err) => {
	console.log(`Something went wrong: ${err}`)
	nick.exit(1)
})