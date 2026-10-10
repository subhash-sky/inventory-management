
const express = require("express");
const router = express.Router();

const {
    createProduct,
    getProducts,
    getProductById,
    updateProduct,
    deleteProduct,
    getLowStockProducts,
    getCategorySummary
} = require("../controllers/productController");

// Specific routes FIRST
router.get("/low-stock", getLowStockProducts);
router.get("/category-summary", getCategorySummary);

// General routes AFTER specific routes
router.post("/", createProduct);
router.get("/", getProducts);
router.get("/:id", getProductById);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);

module.exports = router;
