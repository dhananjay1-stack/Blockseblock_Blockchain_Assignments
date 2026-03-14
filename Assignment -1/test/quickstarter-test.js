import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

/**
 * Helper: returns a future deadline (current block timestamp + offset in seconds).
 */
async function futureDeadline(offsetSeconds = 3600) {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp + offsetSeconds;
}

/**
 * Helper: advances the blockchain time by the given number of seconds.
 * Uses EVM-specific JSON-RPC methods (evm_increaseTime + evm_mine).
 */
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("QuickStarter", function () {
  let quickStarter;
  let owner, alice, bob;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    quickStarter = await ethers.deployContract("QuickStarter");
  });

  // =========================================================================
  //  createCampaign
  // =========================================================================
  describe("createCampaign", function () {
    it("should create a campaign successfully", async function () {
      const goal = ethers.parseEther("10");
      const deadline = await futureDeadline(3600);

      const tx = await quickStarter.createCampaign("Test Campaign", goal, deadline);
      const receipt = await tx.wait();

      // Verify stored fields
      const campaign = await quickStarter.campaigns(1);
      expect(campaign.id).to.equal(1n);
      expect(campaign.title).to.equal("Test Campaign");
      expect(campaign.creator).to.equal(owner.address);
      expect(campaign.goal).to.equal(goal);
      expect(campaign.pledged).to.equal(0n);
      expect(campaign.deadline).to.equal(BigInt(deadline));
      expect(campaign.open).to.equal(true);

      // Verify ID auto-increment
      expect(await quickStarter.nextCampaignId()).to.equal(2n);

      // Verify event emitted
      await expect(tx)
        .to.emit(quickStarter, "CampaignCreated")
        .withArgs(1n, owner.address, "Test Campaign", goal, BigInt(deadline));
    });

    it("should auto-increment campaign IDs", async function () {
      const goal = ethers.parseEther("1");
      const deadline = await futureDeadline(3600);

      await quickStarter.createCampaign("Campaign 1", goal, deadline);
      await quickStarter.createCampaign("Campaign 2", goal, deadline);

      const c1 = await quickStarter.campaigns(1);
      const c2 = await quickStarter.campaigns(2);

      expect(c1.id).to.equal(1n);
      expect(c2.id).to.equal(2n);
      expect(await quickStarter.nextCampaignId()).to.equal(3n);
    });

    it("should revert when creating a campaign with zero goal", async function () {
      const deadline = await futureDeadline(3600);

      await expect(
        quickStarter.createCampaign("Zero Goal", 0, deadline)
      ).to.be.revertedWith("Goal must be greater than zero");
    });

    it("should revert when creating a campaign with past deadline", async function () {
      const pastDeadline = 1000; // A timestamp far in the past

      await expect(
        quickStarter.createCampaign("Past Deadline", ethers.parseEther("1"), pastDeadline)
      ).to.be.revertedWith("Deadline must be in the future");
    });

    it("should revert when creating a campaign with current block timestamp as deadline", async function () {
      const block = await ethers.provider.getBlock("latest");
      const currentTimestamp = block.timestamp;

      await expect(
        quickStarter.createCampaign(
          "Immediate Deadline",
          ethers.parseEther("1"),
          currentTimestamp
        )
      ).to.be.revertedWith("Deadline must be in the future");
    });
  });

  // =========================================================================
  //  contribute
  // =========================================================================
  describe("contribute", function () {
    let campaignId;
    const goal = ethers.parseEther("5");

    beforeEach(async function () {
      const deadline = await futureDeadline(3600);
      await quickStarter.createCampaign("Fundable Campaign", goal, deadline);
      campaignId = 1;
    });

    it("should accept valid contributions", async function () {
      const amount = ethers.parseEther("2");

      const tx = await quickStarter
        .connect(alice)
        .contribute(campaignId, { value: amount });

      // Check pledged amount increased
      const campaign = await quickStarter.campaigns(campaignId);
      expect(campaign.pledged).to.equal(amount);

      // Check contributions mapping updated
      const recorded = await quickStarter.contributions(campaignId, alice.address);
      expect(recorded).to.equal(amount);

      // Check event emitted
      await expect(tx)
        .to.emit(quickStarter, "ContributionReceived")
        .withArgs(BigInt(campaignId), alice.address, amount);
    });

    it("should accumulate multiple contributions from the same user", async function () {
      const amount1 = ethers.parseEther("1");
      const amount2 = ethers.parseEther("2");

      await quickStarter.connect(alice).contribute(campaignId, { value: amount1 });
      await quickStarter.connect(alice).contribute(campaignId, { value: amount2 });

      const recorded = await quickStarter.contributions(campaignId, alice.address);
      expect(recorded).to.equal(amount1 + amount2);

      const campaign = await quickStarter.campaigns(campaignId);
      expect(campaign.pledged).to.equal(amount1 + amount2);
    });

    it("should accept contributions from multiple users", async function () {
      const amountAlice = ethers.parseEther("2");
      const amountBob = ethers.parseEther("3");

      await quickStarter.connect(alice).contribute(campaignId, { value: amountAlice });
      await quickStarter.connect(bob).contribute(campaignId, { value: amountBob });

      expect(await quickStarter.contributions(campaignId, alice.address)).to.equal(amountAlice);
      expect(await quickStarter.contributions(campaignId, bob.address)).to.equal(amountBob);

      const campaign = await quickStarter.campaigns(campaignId);
      expect(campaign.pledged).to.equal(amountAlice + amountBob);
    });

    it("should emit GoalReached when the goal is met", async function () {
      const tx = await quickStarter
        .connect(alice)
        .contribute(campaignId, { value: goal });

      await expect(tx)
        .to.emit(quickStarter, "GoalReached")
        .withArgs(BigInt(campaignId), goal);
    });

    it("should revert when contribution amount is zero", async function () {
      await expect(
        quickStarter.connect(alice).contribute(campaignId, { value: 0 })
      ).to.be.revertedWith("Contribution must be greater than zero");
    });

    it("should revert when contributing to a non-existent campaign", async function () {
      await expect(
        quickStarter.connect(alice).contribute(999, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Campaign does not exist");
    });

    it("should revert when contributing after deadline", async function () {
      // Move time forward past the 1-hour deadline
      await increaseTime(3601);

      await expect(
        quickStarter
          .connect(alice)
          .contribute(campaignId, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("Campaign deadline has passed");
    });
  });

  // =========================================================================
  //  withdraw (optional feature)
  // =========================================================================
  describe("withdraw", function () {
    let campaignId;
    const goal = ethers.parseEther("5");

    beforeEach(async function () {
      const deadline = await futureDeadline(3600);
      await quickStarter.createCampaign("Withdrawable", goal, deadline);
      campaignId = 1;
    });

    it("should allow creator to withdraw funds when goal is met after deadline", async function () {
      // Fund the campaign fully
      await quickStarter.connect(alice).contribute(campaignId, { value: goal });

      // Move time past the deadline
      await increaseTime(3601);

      // Record creator balance before withdrawal
      const balanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await quickStarter.connect(owner).withdraw(campaignId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      // Verify balance increased (minus gas)
      const balanceAfter = await ethers.provider.getBalance(owner.address);
      expect(balanceAfter).to.equal(balanceBefore + goal - gasUsed);

      // Verify campaign is closed
      const campaign = await quickStarter.campaigns(campaignId);
      expect(campaign.open).to.equal(false);

      // Verify event emitted
      await expect(tx)
        .to.emit(quickStarter, "FundsWithdrawn")
        .withArgs(BigInt(campaignId), owner.address, goal);
    });

    it("should revert if non-creator tries to withdraw", async function () {
      await quickStarter.connect(alice).contribute(campaignId, { value: goal });
      await increaseTime(3601);

      await expect(
        quickStarter.connect(alice).withdraw(campaignId)
      ).to.be.revertedWith("Only the campaign creator can call this");
    });

    it("should revert if campaign is still active", async function () {
      await quickStarter.connect(alice).contribute(campaignId, { value: goal });

      await expect(
        quickStarter.connect(owner).withdraw(campaignId)
      ).to.be.revertedWith("Campaign is still active");
    });

    it("should revert if funding goal is not reached", async function () {
      // Contribute less than the goal
      await quickStarter
        .connect(alice)
        .contribute(campaignId, { value: ethers.parseEther("1") });
      await increaseTime(3601);

      await expect(
        quickStarter.connect(owner).withdraw(campaignId)
      ).to.be.revertedWith("Funding goal not reached");
    });

    it("should revert if funds are already withdrawn", async function () {
      await quickStarter.connect(alice).contribute(campaignId, { value: goal });
      await increaseTime(3601);

      // First withdrawal succeeds
      await quickStarter.connect(owner).withdraw(campaignId);

      // Second withdrawal reverts
      await expect(
        quickStarter.connect(owner).withdraw(campaignId)
      ).to.be.revertedWith("Funds already withdrawn");
    });
  });
});
