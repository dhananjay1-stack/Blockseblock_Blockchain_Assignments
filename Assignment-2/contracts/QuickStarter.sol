// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title QuickStarter - A Mini Crowdfunding DApp
/// @notice Allows users to create campaigns and contribute ETH towards funding goals
contract QuickStarter {
    uint256 public nextCampaignId = 1;

    struct Campaign {
        uint256 id;
        string title;
        address payable creator;
        uint256 goal;
        uint256 pledged;
        uint256 deadline;
        bool open;
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public contributions;

    // --- Events ---
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

    // --- Modifiers ---
    modifier campaignExists(uint256 _id) {
        require(campaigns[_id].id != 0, "Campaign does not exist");
        _;
    }

    modifier onlyCreator(uint256 _id) {
        require(msg.sender == campaigns[_id].creator, "Only campaign creator can call this");
        _;
    }

    modifier onlyWhileOpen(uint256 _id) {
        require(campaigns[_id].open, "Campaign is closed");
        require(block.timestamp < campaigns[_id].deadline, "Campaign deadline has passed");
        _;
    }

    /// @notice Create a new crowdfunding campaign
    /// @param _title The title of the campaign
    /// @param _goalInWei The funding goal in Wei
    /// @param _deadline The Unix timestamp deadline for contributions
    /// @return The ID of the newly created campaign
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

    /// @notice Contribute ETH to an active campaign
    /// @param _campaignId The ID of the campaign to contribute to
    function contribute(uint256 _campaignId)
        external
        payable
        campaignExists(_campaignId)
        onlyWhileOpen(_campaignId)
    {
        require(msg.value > 0, "Contribution must be greater than zero");

        Campaign storage campaign = campaigns[_campaignId];
        campaign.pledged += msg.value;
        contributions[_campaignId][msg.sender] += msg.value;

        emit ContributionReceived(_campaignId, msg.sender, msg.value);

        if (campaign.pledged >= campaign.goal) {
            emit GoalReached(_campaignId, campaign.pledged);
        }
    }

    /// @notice Allows the campaign creator to withdraw funds after the goal is met
    /// @dev Uses checks-effects-interactions pattern to prevent reentrancy
    /// @param _campaignId The ID of the campaign to withdraw from
    function withdrawFunds(uint256 _campaignId)
        external
        campaignExists(_campaignId)
        onlyCreator(_campaignId)
    {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.pledged >= campaign.goal, "Funding goal not yet reached");
        require(campaign.open, "Funds already withdrawn");

        // Checks-Effects-Interactions: update state before external call
        uint256 amount = campaign.pledged;
        campaign.open = false;

        (bool success, ) = campaign.creator.call{value: amount}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(_campaignId, campaign.creator, amount);
    }

    /// @notice Get full campaign details
    /// @param _campaignId The ID of the campaign
    function getCampaign(uint256 _campaignId)
        external
        view
        campaignExists(_campaignId)
        returns (Campaign memory)
    {
        return campaigns[_campaignId];
    }
}
