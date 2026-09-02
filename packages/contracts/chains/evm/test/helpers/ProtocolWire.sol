// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Protocol} from "../../solidity/Protocol.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../solidity/steward/StewardRegistry.sol";
import {LvstToken} from "../../solidity/treasury/LvstToken.sol";
import {Treasury} from "../../solidity/treasury/Treasury.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {DripsStreaming} from "../../solidity/streaming/DripsStreaming.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {ManagedProxy} from "../../solidity/streaming/Managed.sol";
import {MarketDriver} from "../../solidity/streaming/drivers/MarketDriver.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Shared deploy + Protocol wiring for Foundry tests and local harnesses.
library ProtocolWire {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Core {
        Protocol protocol;
        MarketRegistry marketRegistry;
        Vault vault;
        StewardRegistry stewardRegistry;
        LvstToken lvstToken;
        Treasury treasury;
        VaultDriver vaultDriver;
        MockUSDC usdc;
    }

    struct Streaming {
        DripsStreaming drips;
        MarketDriver marketDriver;
    }

    function deployCore(address owner, IERC20 usdc) internal returns (Core memory core) {
        core.protocol = new Protocol(owner);
        core.marketRegistry = new MarketRegistry(owner, core.protocol);
        core.vault = new Vault(core.protocol);
        core.stewardRegistry = new StewardRegistry(owner, core.protocol);
        core.lvstToken = new LvstToken(core.protocol);
        core.treasury = new Treasury(owner, usdc, core.protocol);
        core.usdc = MockUSDC(address(usdc));
    }

    function deployStreaming(address admin, Vault, MockUSDC usdc, uint32 cycleSecs)
        internal
        returns (Streaming memory streaming)
    {
        usdc;
        DripsStreaming logic = new DripsStreaming(cycleSecs);
        streaming.drips = DripsStreaming(address(new ManagedProxy(logic, admin, "")));
    }

    function wireAll(address owner, Core memory core, Streaming memory streaming) internal returns (Streaming memory) {
        return wireAll(owner, core, streaming, true);
    }

    function wireAll(address owner, Core memory core, Streaming memory streaming, bool withLvst)
        internal
        returns (Streaming memory)
    {
        vm.startPrank(owner);
        core.protocol.setMarketRegistry(address(core.marketRegistry));
        core.protocol.setVault(address(core.vault));
        core.protocol.setStewardRegistry(address(core.stewardRegistry));
        if (withLvst) {
            core.protocol.setLvstToken(address(core.lvstToken));
            core.protocol.setTreasury(address(core.treasury));
        }
        core.protocol.setDripsStreaming(address(streaming.drips));
        vm.stopPrank();

        core.vaultDriver =
            new VaultDriver(core.protocol, address(streaming.drips), address(0), IERC20(address(core.usdc)));
        core.vaultDriver.bootstrapStreaming();
        vm.prank(owner);
        core.protocol.setVaultDriver(address(core.vaultDriver));

        vm.startPrank(owner);
        uint32 marketDriverId = streaming.drips.registerDriver(owner);
        vm.stopPrank();

        MarketDriver driverLogic = new MarketDriver(
            address(streaming.drips),
            address(0),
            marketDriverId,
            core.protocol,
            core.vault,
            core.vaultDriver,
            address(core.usdc)
        );
        streaming.marketDriver = MarketDriver(address(new ManagedProxy(driverLogic, owner, "")));

        vm.prank(owner);
        streaming.drips.updateDriverAddress(marketDriverId, address(streaming.marketDriver));

        vm.prank(owner);
        core.protocol.setMarketDriver(address(streaming.marketDriver));

        core.vault.syncFromProtocol();
        return streaming;
    }
}
