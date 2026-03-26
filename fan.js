const express = require("express");
const router = express.Router();
const { renderLogin, handleLogin } = require("../controllers/fanController");

// GET login page
router.get("/login", renderLogin);

// POST login form
router.post("/login", handleLogin);

module.exports = router;

