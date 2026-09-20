import { isIPv4 } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { WebNetworkAddress } from "../../shared/types";

type NetworkInterfaceMap = Record<string, NetworkInterfaceInfo[] | undefined>;

function isPrivateIpv4(address: string): boolean {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}
	const [first, second] = parts;
	return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/**
 * 枚举所有非回环 IPv4 网卡，局域网地址排在前面。
 * 机器同时连接 Wi-Fi、网线、VPN 或虚拟网卡时，调用方可让用户切换具体入口。
 */
export function listWebNetworkAddresses(interfaces: NetworkInterfaceMap = networkInterfaces()): WebNetworkAddress[] {
	const addresses: WebNetworkAddress[] = [];
	const seen = new Set<string>();

	for (const [interfaceName, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			const address = entry.address.trim();
			if (!isIPv4(address) || entry.internal || seen.has(address)) continue;
			seen.add(address);
			addresses.push({
				address,
				interfaceName,
				cidr: typeof entry.cidr === "string" ? entry.cidr : null,
				isPrivate: isPrivateIpv4(address),
			});
		}
	}

	return addresses.sort((left, right) => {
		if (left.isPrivate !== right.isPrivate) return left.isPrivate ? -1 : 1;
		return left.address.localeCompare(right.address, undefined, { numeric: true });
	});
}
