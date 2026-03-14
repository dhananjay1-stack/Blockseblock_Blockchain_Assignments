// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title QuickStarter
 * @notice A mini crowdfunding smart contract where users can create campaigns
 *         and contribute ETH toward funding goals.
 * @dev Uses struct, mapping, modifier, require, and events as specified.
 *      Implements checks-effects-interactions pattern for reentrancy protection.
 */
contract QuickStarter {
    // -----------------------------------------------------------------------
    //  State
    // -----------------------------------------------------------------------

    /// @notice Auto-incrementing campaign ID (starts at 1).
    uint256 public nextCampaignId = 1;

    /// @notice Campaign data structure.
    struct Campaign {
        uint256 id;
        string title;
        address payable creator;
        uint256 goal;
        uint256 pledged;
        uint256 deadline;
        bool open;
    }

    /// @notice Mapping of campaign ID to Campaign struct.
    mapping(uint256 => Campaign) public campaigns;

    /// @notice Nested mapping: campaignId => contributor => amount contributed.
    mapping(uint256 => mapping(address => uint256)) public contributions;

    // -----------------------------------------------------------------------
    //  Events
    // -----------------------------------------------------------------------

    event CampaignCreated(
        uint256 indexed id,
        address indexed creator,
        string title,
        uint256 goal,
        uint256 deadline
    );

    event ContributionReceived(
        uint256 indexed id,
        address indexed contributor,
        uint256 amount
    );

    event GoalReached(uint256 indexed id, uint256 totalPledged);

    event FundsWithdrawn(uint256 indexed id, address indexed creator, uint256 amount);

    // -----------------------------------------------------------------------
    //  Modifiers
    // -----------------------------------------------------------------------

    /// @notice Ensures the campaign with the given ID exists.
    modifier campaignExists(uint256 _id) {
        require(campaigns[_id].id != 0, "Campaign does not exist");
        _;
    }

    /// @notice Ensures the campaign is still open and before its deadline.
    modifier onlyWhileOpen(uint256 _id) {
        require(campaigns[_id].open, "Campaign is closed");
        require(block.timestamp < campaigns[_id].deadline, "Campaign deadline has passed");
        _;
    }

    /// @notice Restricts access to the campaign creator only.
    modifier onlyCreator(uint256 _id) {
        require(msg.sender == campaigns[_id].creator, "Only the campaign creator can call this");
        _;
    }

    // -----------------------------------------------------------------------
    //  Core Functions
    // -----------------------------------------------------------------------

    /**
     * @notice Creates a new crowdfunding campaign.
     * @param _title    The title / name of the campaign.
     * @param _goalInWei The funding goal in Wei.
     * @param _deadline  Unix timestamp after which contributions are rejected.
     * @return id The auto-incremented campaign ID.
     */
    function createCampaign(
        string calldata _title,
        uint256 _goalInWei,
        uint256 _deadline
    ) external returns (uint256) {
        require(_goalInWei > 0, "Goal must be greater than zero");
        require(_deadline > block.timestamp, "Deadline must be in the future");

        uint256 id = nextCampaignId++;

        campaigns[id] = Campaign({
            id: id,
            title: _title,
            creator: payable(msg.sender),
            goal: _goalInWei,
            pledged: 0,
            deadline: _deadline,
            open: true
        });

        emit CampaignCreated(id, msg.sender, _title, _goalInWei, _deadline);

        return id;
    }

    /**
     * @notice Contribute ETH to an active campaign.
     * @param _campaignId The ID of the campaign to fund.
     */
    function contribute(uint256 _campaignId)
        external
        payable
        campaignExists(_campaignId)
        onlyWhileOpen(_campaignId)
    {
        require(msg.value > 0, "Contribution must be greater than zero");

        // Effects
        campaigns[_campaignId].pledged += msg.value;
        contributions[_campaignId][msg.sender] += msg.value;

        emit ContributionReceived(_campaignId, msg.sender, msg.value);

        // Emit GoalReached once the goal is met
        if (campaigns[_campaignId].pledged >= campaigns[_campaignId].goal) {
            emit GoalReached(_campaignId, campaigns[_campaignId].pledged);
        }
    }

    // -----------------------------------------------------------------------
    //  Withdraw (optional but included for completeness)
    // -----------------------------------------------------------------------

    /**
     * @notice Allows the campaign creator to withdraw funds after the deadline,
     *         only if the funding goal has been met.
     * @dev    Uses checks-effects-interactions pattern to prevent reentrancy.
     * @param _campaignId The ID of the campaign to withdraw from.
     */
    function withdraw(uint256 _campaignId)
        external
        campaignExists(_campaignId)
        onlyCreator(_campaignId)
    {
        Campaign storage campaign = campaigns[_campaignId];

        require(block.timestamp >= campaign.deadline, "Campaign is still active");
        require(campaign.pledged >= campaign.goal, "Funding goal not reached");
        require(campaign.open, "Funds already withdrawn");

        uint256 amount = campaign.pledged;

        // Effects — update state BEFORE external call (checks-effects-interactions)
        campaign.open = false;

        // Interaction — external call after state update
        (bool success, ) = campaign.creator.call{value: amount}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(_campaignId, campaign.creator, amount);
    }
}
