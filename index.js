require('dotenv').config({ path: './.env'});
const fs = require('fs');
const Nick = require('nickjs');
const nick = new Nick({headless:true, timeout:60000});
const https = require('https');
const cliProgress = require('cli-progress');

const url = "https://www.ccma.cat/tv3/super3/germans-kratt/videos/";

var requestId;
var videoUrl;

function getPromise(filename, urlValue) {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(filename);
		https.get(urlValue, (response) => {
			const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
			let contentLength = response.headers['content-length'];
			progressBar.start(contentLength, 0);
			response.pipe(file);
			let size = 0;	
			response.on('data', (chunk) => {
				size += chunk.length;
				progressBar.update(size);
			});
			response.on('end', () => {
				resolve(true);
				progressBar.stop();
				process.on('SIGINT', null);
				process.on('SIGUSR1', null);
				process.on('SIGUSR2', null);
				process.on('uncaughtException', null);
			});

			let cleanProgress = () => {
				progressBar.stop();
				process.exit();
			}

			process.on('SIGINT', cleanProgress);
			process.on('SIGUSR1', cleanProgress);
			process.on('SIGUSR2', cleanProgress);
			process.on('uncaughtException', cleanProgress);
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
	try {
		console.log("Try to accept cookies...");
		await tab.waitUntilVisible('.qc-cmp-button:nth-child(2)');
		await tab.click('.qc-cmp-button:nth-child(2)');
	} catch (err) {

	}
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
						data.push(title[0].innerText.replace('!', '').replace('?', ''));
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
	for (idx in currentVideos) {
		const title = currentVideos[idx];
		const path = `./${title}.mp4`;
		if (!fs.existsSync(path)) {
			requiredVideos.push({title: title, index: idx});
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

async function moveToNextPage(tab) {
	const result = await tab.evaluate((args, callback) => {
		const nextDisabled = document.getElementsByClassName('R-seg inactiu');
		if (nextDisabled !== undefined && typeof nextDisabled === "object" && nextDisabled.length === 1) {
			callback(null, false);
		} else {
			const nextActive = document.getElementsByClassName('R-seg');
			if (nextActive !== undefined && typeof nextActive === "object" && nextActive.length === 1) {
				callback(null, true);
			} else {
				callback(null, false);
			}
		}
	});
	if (result) {
		await tab.click('#pg1 > div > ul > li.R-seg > a');
		await tab.wait(5000);
	}
	return result;
}

;(async () => {
	try {
		var needAcceptCookies = true;
		do {
			const tab = await nick.newTab()
			var downloadMore = false;
			await tab.open(url)
			if (needAcceptCookies) {
				await acceptCookies(tab);
				needAcceptCookies = false;
			}
			var nextPage = false;
			do {
				const currentVideos = await obtainCurrentVideos(tab);
				const requiredVideos = checkRequiredVideos(currentVideos);
				if (requiredVideos.length > 0) {
					await injectNetworkInspector(tab);
	
					// Navigate to first video
					console.log(`Navigate to "${requiredVideos[0].title}" video...`);
					await tab.evaluate((args, callback) => {
						document.getElementsByClassName('media-object')[args.index].click();
						callback(null, true);
					}, requiredVideos[0]);
					await tab.waitUntilVisible('#view19 > div.jw-wrapper.jw-reset > div.jw-controls.jw-reset > div.jw-display.jw-reset > div > div > div.jw-display-icon-container.jw-display-icon-display.jw-reset > div', 20000);
		
					// Download file
					console.log(`Download "${requiredVideos[0].title}" (${videoUrl}) file...`);
					const filename = `${requiredVideos[0].title}.mp4`;
					await makeSynchronousRequest(filename, videoUrl);
					downloadMore = requiredVideos.length > 1;
				}
			} while (await moveToNextPage(tab));

			// Close tab
			await tab.close();
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