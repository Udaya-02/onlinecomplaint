
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || "charani-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 4 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, "public")));

let db;

function loginRequired(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: "Please log in first." });
    }
    next();
}

function adminRequired(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required." });
    }
    next();
}

async function initializeDatabase() {
    const connection = await mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "root"
    });

    await connection.query(
        "CREATE DATABASE IF NOT EXISTS charani_complaints"
    );
    await connection.end();

    db = mysql.createPool({
        host: "localhost",
        user: "root",
        password: "root",
        database: "charani_complaints",
        waitForConnections: true,
        connectionLimit: 10
    });

    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('student','admin') NOT NULL DEFAULT 'student',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS departments (
            department_id INT AUTO_INCREMENT PRIMARY KEY,
            department_name VARCHAR(100) NOT NULL UNIQUE,
            description VARCHAR(255)
        )
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS complaint (
            complaint_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            department_id INT NOT NULL,
            title VARCHAR(150) NOT NULL,
            description TEXT NOT NULL,
            status ENUM('Pending','In Progress','Resolved')
                NOT NULL DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
                ON DELETE CASCADE,
            FOREIGN KEY (department_id)
                REFERENCES departments(department_id)
        )
    `);

    const departments = [
        ["Electrical", "Lights, fans and power problems"],
        ["Plumbing", "Water and plumbing problems"],
        ["Hostel Maintenance", "Room repairs and hostel facilities"],
        ["Internet & Wi-Fi", "Internet and network issues"],
        ["Canteen", "Food and canteen services"],
        ["Cleanliness", "Sanitation and housekeeping"],
        ["Academics", "Classroom and academic facilities"],
        ["Security", "Campus and hostel security"]
    ];

    for (const [name, description] of departments) {
        await db.query(
            `INSERT IGNORE INTO departments
             (department_name, description) VALUES (?, ?)`,
            [name, description]
        );
    }

    console.log("Connected to MySQL: charani_complaints");
    console.log("Tables created: users, departments, complaint");
}

// Register student
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name?.trim() || !email?.trim() || !password) {
            return res.status(400).json({
                error: "Please complete all fields."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: "Password must be at least 8 characters."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const cleanEmail = email.trim().toLowerCase();

        const [result] = await db.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES (?, ?, ?)`,
            [name.trim(), cleanEmail, passwordHash]
        );

        req.session.user = {
            user_id: result.insertId,
            name: name.trim(),
            email: cleanEmail,
            role: "student"
        };

        res.status(201).json({
            message: "Account created successfully.",
            user: req.session.user
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "Email already registered."
            });
        }
        console.error(err);
        res.status(500).json({ error: "Registration failed." });
    }
});

// Login
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: "Enter your email and password."
            });
        }

        const [rows] = await db.query(
            `SELECT user_id, name, email, password_hash, role
             FROM users WHERE email = ?`,
            [email.trim().toLowerCase()]
        );

        if (!rows.length ||
            !(await bcrypt.compare(password, rows[0].password_hash))) {
            return res.status(401).json({
                error: "Invalid email or password."
            });
        }

        const u = rows[0];

        req.session.regenerate(err => {
            if (err) {
                return res.status(500).json({
                    error: "Could not create login session."
                });
            }

            req.session.user = {
                user_id: u.user_id,
                name: u.name,
                email: u.email,
                role: u.role
            };

            res.json({
                message: "Login successful.",
                user: req.session.user
            });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Login failed." });
    }
});

// Current login - supports both frontend routes
app.get("/api/me", (req, res) => {
    res.json({ user: req.session.user || null });
});

app.get("/api/session", (req, res) => {
    res.json({ user: req.session.user || null });
});

// Logout
app.post("/api/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: "Logout failed." });
        }
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out." });
    });
});

// Departments
app.get("/api/departments", async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT * FROM departments ORDER BY department_name"
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Unable to load departments." });
    }
});

// Submit complaint
app.post("/api/complaints", loginRequired, async (req, res) => {
    try {
        const { department_id, title, description } = req.body;

        if (!department_id || !title?.trim() || !description?.trim()) {
            return res.status(400).json({
                error: "Please complete all complaint fields."
            });
        }

        const [result] = await db.query(
            `INSERT INTO complaint
             (user_id, department_id, title, description)
             VALUES (?, ?, ?, ?)`,
            [
                req.session.user.user_id,
                department_id,
                title.trim(),
                description.trim()
            ]
        );

        res.status(201).json({
            message: "Complaint submitted successfully.",
            complaint_id: result.insertId
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Complaint submission failed." });
    }
});

// Students see their complaints; admins see all
app.get("/api/complaints", loginRequired, async (req, res) => {
    try {
        let sql = `
            SELECT c.complaint_id, c.title, c.description, c.status,
                   c.created_at, u.name AS student_name, u.email,
                   d.department_name
            FROM complaint c
            JOIN users u ON u.user_id = c.user_id
            JOIN departments d ON d.department_id = c.department_id
        `;
        const params = [];

        if (req.session.user.role !== "admin") {
            sql += " WHERE c.user_id = ?";
            params.push(req.session.user.user_id);
        }

        sql += " ORDER BY c.created_at DESC";

        const [rows] = await db.query(sql, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Unable to load complaints." });
    }
});

// Admin updates complaint status
app.patch(
    "/api/complaints/:id/status",
    loginRequired,
    adminRequired,
    async (req, res) => {
        try {
            const { status } = req.body;
            const allowed = ["Pending", "In Progress", "Resolved"];

            if (!allowed.includes(status)) {
                return res.status(400).json({
                    error: "Invalid status."
                });
            }

            const [result] = await db.query(
                "UPDATE complaint SET status = ? WHERE complaint_id = ?",
                [status, req.params.id]
            );

            if (!result.affectedRows) {
                return res.status(404).json({
                    error: "Complaint not found."
                });
            }

            res.json({ message: "Complaint status updated." });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Unable to update status." });
        }
    }
);

initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Charani website: http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error("MySQL startup error:", err.message);
        process.exit(1);
    });
