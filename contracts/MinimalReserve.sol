// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ReceiverTemplate } from "./interfaces/ReceiverTemplate.sol";

contract ReserveManager is ReceiverTemplate{

    uint256 public lastTotalMinted;
    uint256 public lastTotalReserve;
    uint256 public lastRiskScore;
    uint256 public lastUpdatedAt;
    uint256 private requestIdCounter;

    constructor(address forwarderAddress) ReceiverTemplate(forwarderAddress) {}

    function updateReserves(uint256 totalMinted, uint256 totalReserve, uint256 riskScore) private {
        lastTotalMinted = totalMinted;
        lastTotalReserve = totalReserve;
        lastRiskScore = riskScore;
        lastUpdatedAt = block.timestamp;
        requestIdCounter++;
    }

    function _processReport(bytes calldata report) internal override {
        (uint256 totalMinted, uint256 totalReserve, uint256 riskScore) = abi.decode(report, (uint256, uint256, uint256));

        updateReserves(totalMinted, totalReserve, riskScore);
    }

}