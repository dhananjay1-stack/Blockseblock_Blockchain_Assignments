const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("QuickStarter", function () {
  let quickStarter;
  let owner, contributor1, contributor2;

  const ONE_ETH = ethers.parseEther("1");
  const FIVE_ETH = ethers.parseEther("5");

  // Helper: returns a future deadline (current time + duration in seconds)
  async function futureDeadline(seconds = 86400) {
    const latest = await time.latest();
    return latest + seconds;
  }

  beforeEach(async function () {
    [owner, contributor1, contributor2] = await ethers.getSigners();
    const QuickStarter = await ethers.getContractFactory("QuickStarter");
    quickStarter = await QuickStarter.deploy();
  });

  // =========================================================================
  // Campaign Creation
  // =========================================================================
  describe("Campaign Creation", function () {
    it("should create a campaign successfully", async function () {
      const deadline = await futureDeadline();

      const tx = await quickStarter.createCampaign("Save the Trees", FIVE_ETH, deadline);
      const receipt = await tx.wait();

      // Verify stored fields
      const campaign = await quickStarter.getCampaign(1);
      expect(campaign.id).to.equal(1);
      expect(campaign.title).to.equal("Save the Trees");
      expect(campaign.creator).to.equal(owner.address);
      expect(campaign.goal).to.equal(FIVE_ETH);
      expect(campaign.pledged).to.equal(0);
      expect(campaign.deadline).to.equal(deadline);
      expect(campaign.open).to.equal(true);

      // Verify ID auto-increment
      expect(await quickStarter.nextCampaignId()).to.equal(2);

      // Verify event emitted
      await expect(tx)
        .to.emit(quickStarter, "CampaignCreated")
        .withArgs(1, owner.address, "Save the Trees", FIVE_ETH, deadline);
    });

    it("should auto-increment campaign IDs", async function () {
      const deadline = await futureDeadline();

      await quickStarter.createCampaign("Campaign 1", ONE_ETH, deadline);
      await quickStarter.createCampaign("Campaign 2", FIVE_ETH, deadline);

      const campaign1 = await quickStarter.getCampaign(1);
      const campaign2 = await quickStarter.getCampaign(2);

      expect(campaign1.id).to.equal(1);
      expect(campaign2.id).to.equal(2);
      expect(await quickStarter.nextCampaignId()).to.equal(3);
    });

    it("should revert when creating a campaign with zero goal", async function () {
      const deadline = await futureDeadline();

      await expect(
        quickStarter.createCampaign("Zero Goal", 0, deadline)
      ).to.be.revertedWith("Goal must be greater than zero");
    });

    it("should revert when creating a campaign with past deadline", async function () {
      const pastDeadline = (await time.latest()) - 100;

      await expect(
        quickStarter.createCampaign("Past Deadline", ONE_ETH, pastDeadline)
      ).to.be.revertedWith("Deadline must be in the future");
    });

    it("should revert when creating a campaign with current block timestamp as deadline", async function () {
      const currentTime = await time.latest();

      // The next block's timestamp will be >= currentTime, so using currentTime
      // should fail since we require _deadline > block.timestamp
      await expect(
        quickStarter.createCampaign("Now Deadline", ONE_ETH, currentTime)
      ).to.be.revertedWith("Deadline must be in the future");
    });
  });

  // =========================================================================
  // Contributions
  // =========================================================================
  describe("Contributions", function () {
    let deadline;

    beforeEach(async function () {
      deadline = await futureDeadline();
      await quickStarter.createCampaign("Fund My Project", FIVE_ETH, deadline);
    });

    it("should accept valid contributions", async function () {
      const tx = await quickStarter
        .connect(contributor1)
        .contribute(1, { value: ONE_ETH });

      // Assert pledged increased
      const campaign = await quickStarter.getCampaign(1);
      expect(campaign.pledged).to.equal(ONE_ETH);

      // Assert contributions mapping updated
      const recorded = await quickStarter.contributions(1, contributor1.address);
      expect(recorded).to.equal(ONE_ETH);

      // Assert event emitted
      await expect(tx)
        .to.emit(quickStarter, "ContributionReceived")
        .withArgs(1, contributor1.address, ONE_ETH);
    });

    it("should accumulate multiple contributions from same contributor", async function () {
      await quickStarter.connect(contributor1).contribute(1, { value: ONE_ETH });
      await quickStarter.connect(contributor1).contribute(1, { value: ONE_ETH });

      const campaign = await quickStarter.getCampaign(1);
      expect(campaign.pledged).to.equal(ONE_ETH * 2n);

      const recorded = await quickStarter.contributions(1, contributor1.address);
      expect(recorded).to.equal(ONE_ETH * 2n);
    });

    it("should accept contributions from multiple contributors", async function () {
      await quickStarter.connect(contributor1).contribute(1, { value: ONE_ETH });
      await quickStarter.connect(contributor2).contribute(1, { value: ethers.parseEther("2") });

      const campaign = await quickStarter.getCampaign(1);
      expect(campaign.pledged).to.equal(ethers.parseEther("3"));

      expect(await quickStarter.contributions(1, contributor1.address)).to.equal(ONE_ETH);
      expect(await quickStarter.contributions(1, contributor2.address)).to.equal(ethers.parseEther("2"));
    });

    it("should emit GoalReached when pledged meets the goal", async function () {
      const tx = await quickStarter
        .connect(contributor1)
        .contribute(1, { value: FIVE_ETH });

      await expect(tx)
        .to.emit(quickStarter, "GoalReached")
        .withArgs(1, FIVE_ETH);
    });

    it("should revert when contribution amount is zero", async function () {
      await expect(
        quickStarter.connect(contributor1).contribute(1, { value: 0 })
      ).to.be.revertedWith("Contribution must be greater than zero");
    });

    it("should revert when contributing to a non-existent campaign", async function () {
      await expect(
        quickStarter.connect(contributor1).contribute(999, { value: ONE_ETH })
      ).to.be.revertedWith("Campaign does not exist");
    });

    it("should revert when contributing after deadline", async function () {
      // Advance time past the deadline
      await time.increaseTo(deadline + 1);

      await expect(
        quickStarter.connect(contributor1).contribute(1, { value: ONE_ETH })
      ).to.be.revertedWith("Campaign deadline has passed");
    });

    it("should revert when contributing to a closed campaign", async function () {
      // Fund the goal and withdraw to mark campaign closed
      await quickStarter.connect(contributor1).contribute(1, { value: FIVE_ETH });
      await quickStarter.connect(owner).withdrawFunds(1);

      await expect(
        quickStarter.connect(contributor2).contribute(1, { value: ONE_ETH })
      ).to.be.revertedWith("Campaign is closed");
    });
  });

  // =========================================================================
  // Withdrawals
  // =========================================================================
  describe("Withdrawals", function () {
    let deadline;

    beforeEach(async function () {
      deadline = await futureDeadline();
      await quickStarter.createCampaign("Withdrawal Test", FIVE_ETH, deadline);
    });

    it("should allow creator to withdraw funds when goal is met", async function () {
      // Fund the campaign to meet its goal
      await quickStarter.connect(contributor1).contribute(1, { value: FIVE_ETH });

      const balanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await quickStarter.connect(owner).withdrawFunds(1);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(owner.address);

      // Owner should receive the full pledged amount minus gas
      expect(balanceAfter).to.equal(balanceBefore + FIVE_ETH - gasCost);

      // Campaign should be closed
      const campaign = await quickStarter.getCampaign(1);
      expect(campaign.open).to.equal(false);

      // Event emitted
      await expect(tx)
        .to.emit(quickStarter, "FundsWithdrawn")
        .withArgs(1, owner.address, FIVE_ETH);
    });

    it("should revert withdrawal when goal is not met", async function () {
      await quickStarter.connect(contributor1).contribute(1, { value: ONE_ETH });

      await expect(
        quickStarter.connect(owner).withdrawFunds(1)
      ).to.be.revertedWith("Funding goal not yet reached");
    });

    it("should revert withdrawal by non-creator", async function () {
      await quickStarter.connect(contributor1).contribute(1, { value: FIVE_ETH });

      await expect(
        quickStarter.connect(contributor1).withdrawFunds(1)
      ).to.be.revertedWith("Only campaign creator can call this");
    });

    it("should revert double withdrawal", async function () {
      await quickStarter.connect(contributor1).contribute(1, { value: FIVE_ETH });
      await quickStarter.connect(owner).withdrawFunds(1);

      await expect(
        quickStarter.connect(owner).withdrawFunds(1)
      ).to.be.revertedWith("Funds already withdrawn");
    });

    it("should revert withdrawal for non-existent campaign", async function () {
      await expect(
        quickStarter.connect(owner).withdrawFunds(999)
      ).to.be.revertedWith("Campaign does not exist");
    });
  });

  // =========================================================================
  // View function
  // =========================================================================
  describe("getCampaign", function () {
    it("should return full campaign details", async function () {
      const deadline = await futureDeadline();
      await quickStarter.createCampaign("Details Test", FIVE_ETH, deadline);

      const campaign = await quickStarter.getCampaign(1);
      expect(campaign.id).to.equal(1);
      expect(campaign.title).to.equal("Details Test");
      expect(campaign.creator).to.equal(owner.address);
      expect(campaign.goal).to.equal(FIVE_ETH);
      expect(campaign.pledged).to.equal(0);
      expect(campaign.deadline).to.equal(deadline);
      expect(campaign.open).to.equal(true);
    });

    it("should revert for non-existent campaign", async function () {
      await expect(quickStarter.getCampaign(42)).to.be.revertedWith(
        "Campaign does not exist"
      );
    });
  });
});
