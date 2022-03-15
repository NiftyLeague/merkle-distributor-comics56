// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import '@openzeppelin/contracts/token/ERC1155/ERC1155.sol';

contract TestERC1155 is ERC1155 {
    constructor(
        uint256[] memory ids,
        uint256[] memory amounts
    ) ERC1155("") {
        setBalance(msg.sender, ids, amounts);
    }

    // sets the balance of the address
    // this mints/burns the amount depending on the current balance
    function setBalance(address to, uint256[] memory ids, uint256[] memory amounts) public {
        require(ids.length == amounts.length, "mismatched balance data");

        for (uint i; i < ids.length; i++) {
            uint256 old = balanceOf(to, ids[i]);
            uint256 amount = amounts[i];
            if (old < amount) {
                _mint(to, ids[i], amount - old, bytes(""));
            } else if (old > amount) {
                _burn(to, ids[i], old - amount);
            }
        }
    }
}
