require('dotenv').config({ path: './.env'});
const fs = require('fs');
const puppeteer = require('puppeteer');
//const Nick = require('nickjs');
//const nick = new Nick({headless:true, timeout:60000});
const https = require('https');
const cliProgress = require('cli-progress');

const url = "https://www.ccma.cat/tv3/super3/germans-kratt/videos/";

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
		await http_promise;
	}
	catch(error) {
		// Promise rejected
		console.log(error);
	}
}

async function acceptCookies(page) {
	try {
		console.log("Try to accept cookies...");
		await page.waitForSelector('#didomi-notice-agree-button', {visible: true});
		await page.click('#didomi-notice-agree-button');
	} catch (err) {

	}
}

async function obtainCurrentVideos(page) {
	console.log("Obtain the current videos...");
	return data = await page.evaluate(() => {
		// Here we're in the page context. It's like being in your browser's inspector tool
		const data = [];
		const mediaObjects = document.getElementsByClassName('media-object');
		if (mediaObjects !== undefined) {
			for (mediaObject of mediaObjects) {
				const textElements = mediaObject.getElementsByClassName('txt');
				if (textElements !== undefined && textElements.length === 1) {
					const title = textElements[0].getElementsByTagName('h2');
					if (title !== undefined && title.length === 1) {
						data.push({
							title: title[0].innerText.replace('!', '').replace('?', ''),
							url: mediaObject.href
						});
					}
				}
			}
		}
		return data;
	});
}

function checkRequiredVideos(currentVideos) {
	console.log(`Check which videos should be downloaded...`);
	const requiredVideos = [];
	for (idx in currentVideos) {
		const title = currentVideos[idx].title;
		const path = `./${title}.mp4`;
		if (!fs.existsSync(path)) {
			requiredVideos.push({title: title, index: idx, url: currentVideos[idx].url});
		}
	}
	return requiredVideos;
}

async function injectNetworkInspector(page) {
	console.log(`Inject network inspector...`);
	const client = await page.target().createCDPSession();
	await client.send('Network.enable');
	await client.send('Network.setRequestInterception', {
		patterns: [{ urlPattern: '*' }],
	});
	await client.on('Network.requestIntercepted', async ({ interceptionId, request, responseHeaders, resourceType }) => {
		await client.send('Network.continueInterceptedRequest', {
			interceptionId: interceptionId,
		});
	});
	await client.on('Network.responseReceived', async ({ requestId, loaderId, timestamp, type, response, frameId }) => {
		if (response.url.includes('media.jsp?media=')) {
			console.log(requestId);
			const responseBody = await client.send('Network.getResponseBody', {requestId });
			const body = JSON.parse(responseBody.base64Encoded ? Buffer.from(responseBody.body, 'base64') : responseBody.body);
			for (mediaUrl of body.media.url) {
				if (mediaUrl.label.includes('720p')) {
					videoUrl = mediaUrl.file;
				}
			}
		}
	});
}

async function moveToNextPage(page) {
	const result = await page.evaluate(() => {
		const nextDisabled = document.getElementsByClassName('R-seg inactiu');
		if (nextDisabled !== undefined && typeof nextDisabled === "object" && nextDisabled.length === 1) {
			return false;
		} else {
			const nextActive = document.getElementsByClassName('R-seg');
			if (nextActive !== undefined && typeof nextActive === "object" && nextActive.length === 1) {
				return true;
			} else {
				return false;
			}
		}
	});
	if (result) {
		await page.click('#pg1 > div > ul > li.R-seg > a');
		await page.waitForTimeout(5000);
	}
	return result;
}

;(async () => {
	try {
		const browser = await puppeteer.launch({ headless: true });
		var needAcceptCookies = true;
		do {
			const page = await browser.newPage();
			var downloadMore = false;
			await page.goto(url);
			if (needAcceptCookies) {
				await acceptCookies(page);
				needAcceptCookies = false;
			}
			await injectNetworkInspector(page);
			do {
				const currentVideos = await obtainCurrentVideos(page);
				let requiredVideos = checkRequiredVideos(currentVideos);
				while (requiredVideos.length > 0) {	
					const currentVideo = requiredVideos.shift();
					// Navigate to first video
					console.log(`Navigate to "${currentVideo.title}" video (${currentVideo.url})...`);
					const videoPage = await browser.newPage();
					await injectNetworkInspector(videoPage);
					await videoPage.goto(currentVideo.url);
					await videoPage.waitForSelector('div.jw-display-icon-container.jw-display-icon-display.jw-reset > div', {visible: true});
		
					// Download file
					console.log(`Download "${currentVideo.title}" (${videoUrl}) file...`);
					const filename = `${currentVideo.title}.mp4`;
					await makeSynchronousRequest(filename, videoUrl);
					await videoPage.close();
				}
			} while (await moveToNextPage(page));
			await page.close();
		} while (downloadMore);
		await browser.close()
	} catch(err) {
		console.log("Could not open page:", err)
	}
})()
.then(() => {
	console.log("Job done!")
})
.catch((err) => {
	console.log(`Something went wrong: ${err}`)
})