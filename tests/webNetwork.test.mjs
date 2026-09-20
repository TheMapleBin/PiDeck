import assert from "node:assert/strict";
import test from "node:test";
import { listWebNetworkAddresses } from "../src/main/web/WebNetwork.ts";

test("listWebNetworkAddresses filters loopback and sorts private LAN addresses first", () => {
	const result = listWebNetworkAddresses({
		WiFi: [
			{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: "127.0.0.1/8" },
			{ address: "192.168.1.23", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: "192.168.1.23/24" },
		],
		VPN: [
			{ address: "100.64.0.8", netmask: "255.192.0.0", family: "IPv4", mac: "", internal: false, cidr: "100.64.0.8/10" },
			{ address: "10.0.0.12", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: false, cidr: "10.0.0.12/8" },
		],
		IPv6: [{ address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "", internal: false, cidr: "fe80::1/64" }],
	});

	assert.deepEqual(
		result.map(({ address }) => address),
		["10.0.0.12", "192.168.1.23", "100.64.0.8"],
	);
	assert.equal(result[0].interfaceName, "VPN");
	assert.equal(result[0].isPrivate, true);
	assert.equal(result[2].isPrivate, false);
	assert.equal(
		result.some(({ address }) => address === "127.0.0.1"),
		false,
	);
	assert.equal(
		result.some(({ address }) => address.includes(":")),
		false,
	);
});

test("listWebNetworkAddresses deduplicates addresses across virtual adapters", () => {
	const result = listWebNetworkAddresses({
		Ethernet: [{ address: "172.20.1.5", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: "172.20.1.5/16" }],
		Bridge: [{ address: "172.20.1.5", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: "172.20.1.5/16" }],
	});

	assert.equal(result.length, 1);
	assert.equal(result[0].address, "172.20.1.5");
});
