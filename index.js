const arbundles = require("arbundles");
const processStream = require("arbundles/stream");

const {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	writeFileSync,
	closeSync,
	readSync,
} = require("fs");
//Needed as Arweave redirects with a 302
const https = require("follow-redirects/https");
const { exit } = require("process");

const inputFolder = "./bundles";
const outputFolder = "./output";
const txIdRegex = /^(\w|-){43}$/;

const formatJSON = (object) => JSON.stringify(object, null, "\t");
const isMetadataTx = (item) => item.tags.some((tag) => tag.name === "ArFS");

//Handle arguments from STDIN
const myArgs = process.argv.slice(2);

const downloadBundle = (txId) => {
	let reqURL = `https://arweave.net/${txId}`;
	//Need to promisify
	return new Promise(function (resolve, reject) {
		let promise = https.get(reqURL, (res) => {
			const writeStream = createWriteStream(`${inputFolder}/${txId}`);
			res.pipe(writeStream);
			writeStream.on("finish", () => {
				writeStream.close();
				console.log("Bundle download finished");
				resolve(promise);
			});
		});
		promise.onerror = reject;
	});
};

const checkTxArg = async (myArgs) => {
	if (myArgs.length) {
		if (myArgs[0].match(txIdRegex) != null) {
			let txId = myArgs[0].match(txIdRegex)[0];
			await downloadBundle(txId);
		} else {
			console.log("Invalid Arweave TX");
			exit;
		}
	}
};

const createOutputFolderFor = (bundleList) => {
	// Create output folder if not exists
	if (!existsSync(outputFolder)) {
		mkdirSync(outputFolder);
	}

	bundleList.forEach((name) => {
		const outputFilePath = `${outputFolder}/${name}`;
		if (!existsSync(outputFilePath)) {
			mkdirSync(outputFilePath);
		}
	});
};

const getBundlesFiles = (bundlesFolder) =>
	readdirSync(bundlesFolder).filter((file) => file !== ".gitkeep");

const unpackBundle = async (bundleTxData) => {
	const bundle = arbundles.unbundleData(bundleTxData);

	await bundle.verify();

	return bundle;
};

const unpackBundleFromFile = (file) => {
	const bundleTxData = readFileSync(file);
	return unpackBundle(bundleTxData);
};

const getTxTags = (item) =>
	item.tags.reduce((prev, curr) => {
		return {
			...prev,
			[curr.name]: curr.value,
		};
	}, {});

const getFileDataBuffer = (bundlePath, dataItem) => {
	const { dataOffset, dataSize } = dataItem;

	const dataBuffer = Buffer.alloc(dataSize);
	const fd = openSync(bundlePath);
	readSync(fd, dataBuffer, 0, dataSize, dataOffset);
	closeSync(fd);
	return dataBuffer;
};

const run = async () => {
	//Check arguments for a TxID
	await checkTxArg(myArgs);

	const txIdArg = myArgs[0].match(txIdRegex) ? myArgs[0] : undefined;

	let bundleFiles = getBundlesFiles(inputFolder);
	//Check if there are bundles to unpack
	if (!getBundlesFiles(inputFolder).length) {
		console.log("No bundles provided");
		return;
	}

	if (txIdArg) {
		bundleFiles = bundleFiles.filter((path) => path.includes(txIdArg));
	}

	createOutputFolderFor(bundleFiles);

	bundleFiles.forEach(async (bundleFileName) => {
		const bundlePath = `${inputFolder}/${bundleFileName}`;
		const stream = createReadStream(bundlePath);
		const dataItemsIterable = await processStream.default(stream);

		dataItemsIterable.forEach((item) => {
			const id = item.id;
			const isMetadata = isMetadataTx(item);
			const metadata = isMetadata
				? JSON.parse(getFileDataBuffer(bundlePath, item).toString())
				: {};
			const dataTxId = metadata.dataTxId;
			const tags = getTxTags(item);
			const output = { metadata, tags };
			const outputPath = `${outputFolder}/${bundleFileName}`;
			//For each entity, outputs raw blob, blob tags inside a JSON and the metadata JSON
			if (dataTxId) {
				//const fileData = getFileData(bundle, dataTxId);
				const fileData = getFileDataBuffer(bundlePath, item);
				if (fileData) {
					writeFileSync(
						`${outputPath}/${metadata.dataTxId}`,
						fileData
					);
					writeFileSync(
						`${outputPath}/${id}.json`,
						formatJSON(output)
					);
				}
			} else {
				writeFileSync(
					`${outputPath}/${id}.TAGS.json`,
					formatJSON(output)
				);
			}
		});
	});
	console.log("Bundles unpacked on ./output folder");
};

run();
