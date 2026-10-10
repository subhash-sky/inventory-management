const Product = require("../models/Product");

// 1. Create a product
exports.createProduct = async (req, res, next) => {
  try {
    const product = await Product.create(req.body);

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get all products with filtering, sorting and pagination
exports.getProducts = async (req, res, next) => {
  try {
    const {
      category,
      search,
      minPrice,
      maxPrice,
      sort = "createdAt",
      page = 1,
      limit = 10,
    } = req.query;

    const filter = {};

    if (category) {
      filter.category = { $regex: category, $options: "i" };
    }

    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};

      if (minPrice !== undefined) {
        filter.price.$gte = Number(minPrice);
      }

      if (maxPrice !== undefined) {
        filter.price.$lte = Number(maxPrice);
      }

      if (
        Object.values(filter.price).some(
          (value) => !Number.isFinite(value) || value < 0
        ) ||
        (minPrice !== undefined &&
          maxPrice !== undefined &&
          Number(minPrice) > Number(maxPrice))
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid price range",
        });
      }
    }

    const pageNumber = Number(page);
    const pageSize = Number(limit);

    if (
      !Number.isInteger(pageNumber) ||
      !Number.isInteger(pageSize) ||
      pageNumber < 1 ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Page must be positive; limit must be between 1 and 100",
      });
    }

    const allowedSortFields = [
      "name",
      "price",
      "quantity",
      "createdAt",
    ];

    const sortField = sort.startsWith("-")
      ? sort.slice(1)
      : sort;

    if (!allowedSortFields.includes(sortField)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sort field",
      });
    }

    const sortOrder = sort.startsWith("-") ? -1 : 1;

    const products = await Product.find(filter)
      .sort({ [sortField]: sortOrder })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize);

    const totalProducts = await Product.countDocuments(filter);

    res.json({
      success: true,
      totalProducts,
      currentPage: pageNumber,
      totalPages: Math.ceil(totalProducts / pageSize),
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get a single product
exports.getProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

// 4. Update product details
exports.updateProduct = async (req, res, next) => {
  try {
    const allowedFields = [
      "name",
      "sku",
      "category",
      "price",
      "description",
      "lowStockThreshold",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid product field",
      });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updates,
      { returnDocument: "after", runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Restock or sell products safely
exports.adjustStock = async (req, res, next) => {
  try {
    const { operation, quantity } = req.body;

    if (
      !["restock", "sale"].includes(operation) ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Use operation restock or sale and a positive integer quantity",
      });
    }

    const change = operation === "restock" ? quantity : -quantity;

    const filter = { _id: req.params.id };

    if (operation === "sale") {
      filter.quantity = { $gte: quantity };
    }

    const product = await Product.findOneAndUpdate(
      filter,
      { $inc: { quantity: change } },
      { new: true, runValidators: true }
    );

    if (!product) {
      const exists = await Product.exists({ _id: req.params.id });

      if (!exists) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Insufficient stock for this sale",
      });
    }

    res.json({
      success: true,
      message: "Stock adjusted successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Delete a product
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 7. Low-stock report
exports.getLowStockProducts = async (req, res, next) => {
  try {
    const { threshold } = req.query;
    let filter;

    if (threshold !== undefined) {
      const limit = Number(threshold);

      if (!Number.isInteger(limit) || limit < 0) {
        return res.status(400).json({
          success: false,
          message: "Threshold must be a non-negative integer",
        });
      }

      filter = { quantity: { $lte: limit } };
    } else {
      filter = {
        $expr: { $lte: ["$quantity", "$lowStockThreshold"] },
      };
    }

    const products = await Product.find(filter).sort({ quantity: 1 });

    res.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

// 8. Category-wise inventory summary using aggregation
exports.getCategorySummary = async (req, res, next) => {
  try {
    const summary = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          totalProducts: { $sum: 1 },
          totalUnits: { $sum: "$quantity" },
          inventoryValue: {
            $sum: { $multiply: ["$price", "$quantity"] },
          },
          averagePrice: { $avg: "$price" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          category: "$_id",
          totalProducts: 1,
          totalUnits: 1,
          inventoryValue: 1,
          averagePrice: 1,
        },
      },
    ]);

    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};