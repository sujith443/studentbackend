const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose(); // Use SQLite
const db =  new sqlite3.Database("./teststudentdata.db");

const app = express();
app.use(cors());
app.use(express.json());

// Debugging Middleware (Logs Every API Request)
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`, req.body);
  next();
});



// User Registration API
app.post("/register", (req, res) => {
  const { name, username, email, phone, branch, hallticketnumber, password } = req.body;
  if (!name || !username || !email || !phone || !branch || !hallticketnumber || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const sql = `INSERT INTO users (name, username, email, phone, branch, hallticketnumber, password) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [name, username, email, phone, branch, hallticketnumber, password], function (err) {
    if (err) return res.status(500).json({ message: "Registration failed.", error: err.message });
    res.json({ message: "Registration successful!", userId: this.lastID });
  });
});

// User Login API
app.post("/login", (req, res) => {
  const { hallTicketNumber, password } = req.body;
  console.log("the logindata",req.body);
  
  if (!hallTicketNumber || !password) {
    return res.status(400).json({ message: "Hall Ticket Number and Password are required." });
  }

  db.get("SELECT * FROM users WHERE hallticketnumber = ?", [hallTicketNumber], (err, user) => {
    if (err) return res.status(500).json({ message: "Internal server error." });
    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Invalid Hall Ticket Number or Password." });
    }
    console.log("the user",user);
    
    res.json({ message: "Login successful!", user });
  });
});

// Change Password API (Requires Old Password)
app.put("/update-password", (req, res) => {
  const { hallticketnumber, email, oldPassword, newPassword } = req.body;
  if (!hallticketnumber || !email || !oldPassword || !newPassword) {
    return res.status(400).json({ message: "All fields are required." });
  }

  db.get("SELECT * FROM users WHERE hallticketnumber = ? AND email = ?", [hallticketnumber, email], (err, user) => {
    if (err) return res.status(500).json({ message: "Database error", error: err.message });
    if (!user) return res.status(404).json({ message: "User not found!" });
    if (user.password !== oldPassword) return res.status(401).json({ message: "Incorrect old password!" });

    db.run("UPDATE users SET password = ? WHERE hallticketnumber = ? AND email = ?", [newPassword, hallticketnumber, email], function (err) {
      if (err) return res.status(500).json({ message: "Error updating password", error: err.message });
      res.json({ message: "Password updated successfully!" });
    });
  });
});

// Forgot Password API (Resets Password Without Old Password)
app.post("/forgot-password", (req, res) => {
  const { hallticketnumber, email, newPassword } = req.body;
  if (!hallticketnumber || !email || !newPassword) {
    return res.status(400).json({ message: "All fields are required." });
  }

  db.get("SELECT * FROM users WHERE hallticketnumber = ? AND email = ?", [hallticketnumber, email], (err, user) => {
    if (err) return res.status(500).json({ message: "Database error", error: err.message });
    if (!user) return res.status(404).json({ message: "User not found!" });

    db.run("UPDATE users SET password = ? WHERE hallticketnumber = ? AND email = ?", [newPassword, hallticketnumber, email], function (err) {
      if (err) return res.status(500).json({ message: "Error resetting password", error: err.message });
      res.json({ message: "Password reset successfully!" });
    });
  });
});

// Fetch Student Profile API
app.get("/student/:hallticketnumber", (req, res) => {
  const { hallticketnumber } = req.params;
  db.get("SELECT * FROM students WHERE hallticketnumber = ?", [hallticketnumber], (err, student) => {
    if (err) return res.status(500).json({ message: "Error fetching student profile.", error: err.message });
    if (!student) return res.status(404).json({ message: "Student not found." });
    res.json(student);
  });
});

// Fetch Parent Info API
app.get("/parents/:hallticketnumber", (req, res) => {
  const { hallticketnumber } = req.params;
  db.get("SELECT * FROM parents WHERE student_id = ?", [hallticketnumber], (err, parent) => {
    if (err) return res.status(500).json({ message: "Error fetching parent information.", error: err.message });
    if (!parent) return res.status(404).json({ message: "Parent information not found." });
    res.json(parent);
  });
});

// Fetch Notifications API
app.get("/notifications", (req, res) => {
  db.all("SELECT * FROM notifications ORDER BY date DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ message: "Error fetching notifications.", error: err.message });
    res.json(rows);
  });
});

// Fetch Timetable API
app.get("/timetable", (req, res) => {
  const { branch, section } = req.query;
  
  let query = "SELECT * FROM timetable";
  let params = [];
  
  if (branch && section) {
    query += " WHERE branch = ? AND section = ?";
    params = [branch, section];
  }
  
  query += " ORDER BY day, period";
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ message: "Error fetching timetable data.", error: err.message });
    res.json(rows);
  });
});

// Fetch Attendance API - Enhanced to return subject-wise monthly attendance
app.get("/attendance/:hallticketnumber", (req, res) => {
  const { hallticketnumber } = req.params;
  db.all(
    "SELECT * FROM attendance WHERE student_id = ? ORDER BY year DESC, month DESC, subject",
    [hallticketnumber],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Error fetching attendance.", error: err.message });
      
      if (rows.length === 0) {
        // Return empty default structure if no records found
        return res.json({ 
          overall: { total: 0, present: 0, absent: 0, percentage: 0 },
          monthly: [],
          subjects: []
        });
      }
      
      // Calculate overall attendance
      let totalClasses = 0;
      let totalPresent = 0;
      rows.forEach(row => {
        totalClasses += row.total_classes;
        totalPresent += row.present;
      });
      
      // Get unique months and subjects
      const months = [...new Set(rows.map(row => row.month))];
      const subjects = [...new Set(rows.map(row => row.subject))];
      
      // Prepare monthly attendance by subject
      const monthlyData = months.map(month => {
        const monthRows = rows.filter(row => row.month === month);
        const monthTotal = monthRows.reduce((sum, row) => sum + row.total_classes, 0);
        const monthPresent = monthRows.reduce((sum, row) => sum + row.present, 0);
        
        return {
          month,
          total: monthTotal,
          present: monthPresent,
          absent: monthTotal - monthPresent,
          percentage: Math.round((monthPresent / monthTotal) * 100),
          subjects: subjects.map(subject => {
            const subjectRow = monthRows.find(row => row.subject === subject);
            if (!subjectRow) return { subject, total: 0, present: 0, absent: 0, percentage: 0 };
            
            return {
              subject: subjectRow.subject,
              total: subjectRow.total_classes,
              present: subjectRow.present,
              absent: subjectRow.total_classes - subjectRow.present,
              percentage: Math.round((subjectRow.present / subjectRow.total_classes) * 100)
            };
          })
        };
      });
      
      // Prepare subject-wise overall attendance
      const subjectData = subjects.map(subject => {
        const subjectRows = rows.filter(row => row.subject === subject);
        const subjectTotal = subjectRows.reduce((sum, row) => sum + row.total_classes, 0);
        const subjectPresent = subjectRows.reduce((sum, row) => sum + row.present, 0);
        
        return {
          subject,
          total: subjectTotal,
          present: subjectPresent,
          absent: subjectTotal - subjectPresent,
          percentage: Math.round((subjectPresent / subjectTotal) * 100)
        };
      });
      
      res.json({
        overall: {
          total: totalClasses,
          present: totalPresent,
          absent: totalClasses - totalPresent,
          percentage: Math.round((totalPresent / totalClasses) * 100)
        },
        monthly: monthlyData,
        subjects: subjectData
      });
    }
  );
});

// Fetch Marks API
app.get("/marks/:hallticketnumber", (req, res) => {
  const { hallticketnumber } = req.params;
  db.all("SELECT * FROM marks WHERE student_id = ? ORDER BY subject", [hallticketnumber], (err, rows) => {
    if (err) return res.status(500).json({ message: "Error fetching marks data.", error: err.message });
    
    if (rows.length === 0) {
      return res.status(404).json({ message: "No marks data found for this student." });
    }
    
    // Calculate overall statistics
    const totalMarks = rows.reduce((sum, row) => sum + row.total_marks, 0);
    const avgMarks = totalMarks / rows.length;
    
    // Find max and min subjects
    let maxSubject = { subject: "", marks: 0 };
    let minSubject = { subject: "", marks: 100 };
    
    rows.forEach(row => {
      if (row.total_marks > maxSubject.marks) {
        maxSubject = { subject: row.subject, marks: row.total_marks };
      }
      if (row.total_marks < minSubject.marks) {
        minSubject = { subject: row.subject, marks: row.total_marks };
      }
    });    
    res.json({
      subjects: rows,
      summary: {
        total_subjects: rows.length,
        average_marks: avgMarks.toFixed(2),
        highest_marks: maxSubject,
        lowest_marks: minSubject
      }
    });
  });
});

// Fetch Fees API
app.get("/fees/:hallticketnumber", (req, res) => {
  const { hallticketnumber } = req.params;
  db.all("SELECT * FROM fees WHERE student_id = ? ORDER BY due_date DESC", [hallticketnumber], (err, rows) => {
    if (err) return res.status(500).json({ message: "Error fetching fees data.", error: err.message });
    
    if (rows.length === 0) {
      return res.status(404).json({ message: "No fees data found for this student." });
    }
    
    // Group by fee status
    const paid = rows.filter(row => row.status === 'Paid');
    const pending = rows.filter(row => row.status === 'Pending');
    const partial = rows.filter(row => row.status === 'Partial');
    
    // Calculate total amounts
    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
    const totalPaid = rows.reduce((sum, row) => sum + row.paid, 0);
    const totalDue = rows.reduce((sum, row) => sum + row.due, 0);
    
    res.json({
      fees: rows,
      summary: {
        total_amount: totalAmount,
        total_paid: totalPaid,
        total_due: totalDue,
        paid_items: paid.length,
        pending_items: pending.length,
        partial_items: partial.length
      }
    });
  });
});

// Dashboard Summary API - Returns a quick overview of student information
app.get("/dashboard/:hallticketnumber", (req, res) => {
  const { hallticketnumber } = req.params;
  
  // Get student details
  db.get("SELECT * FROM students WHERE hallticketnumber = ?", [hallticketnumber], (err, student) => {
    if (err) return res.status(500).json({ message: "Database error", error: err.message });
    if (!student) return res.status(404).json({ message: "Student not found." });
    
    // Get attendance summary
    db.all("SELECT * FROM attendance WHERE student_id = ?", [hallticketnumber], (errAtt, attendance) => {
      if (errAtt) return res.status(500).json({ message: "Error fetching attendance", error: errAtt.message });
      
      // Calculate overall attendance percentage
      let totalClasses = 0;
      let totalPresent = 0;
      
      attendance.forEach(row => {
        totalClasses += row.total_classes;
        totalPresent += row.present;
      });
      
      const attendancePercentage = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;
      
      // Get fees status - check if any pending fees
      db.all("SELECT * FROM fees WHERE student_id = ? AND status != 'Paid'", [hallticketnumber], (errFees, fees) => {
        if (errFees) return res.status(500).json({ message: "Error fetching fees", error: errFees.message });
        
        const pendingFeesAmount = fees.reduce((sum, row) => sum + row.due, 0);
        const hasPendingFees = pendingFeesAmount > 0;
        
        // Get latest notifications
        db.all("SELECT * FROM notifications ORDER BY date DESC LIMIT 5", [], (errNotif, notifications) => {
          if (errNotif) return res.status(500).json({ message: "Error fetching notifications", error: errNotif.message });
          
          // Get today's timetable
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const today = days[new Date().getDay()];
          
          db.all(
            "SELECT * FROM timetable WHERE day = ? AND branch = ? AND section = ? ORDER BY period",
            [today, student.branch, student.section],
            (errTime, todayClasses) => {
              if (errTime) return res.status(500).json({ message: "Error fetching timetable", error: errTime.message });
              
              // Get latest marks
              db.all("SELECT * FROM marks WHERE student_id = ?", [hallticketnumber], (errMarks, marks) => {
                if (errMarks) return res.status(500).json({ message: "Error fetching marks", error: errMarks.message });
                
                // Calculate average marks
                const totalMarks = marks.reduce((sum, row) => sum + row.total_marks, 0);
                const avgMarks = marks.length > 0 ? (totalMarks / marks.length).toFixed(2) : 0;
                
                // Prepare dashboard response
                res.json({
                  student: {
                    name: student.name,
                    hallTicketNumber: student.hallticketnumber,
                    branch: student.branch,
                    section: student.section,
                    year: student.year,
                    semester: student.semester
                  },
                  academicSummary: {
                    attendance: {
                      percentage: attendancePercentage,
                      status: attendancePercentage >= 75 ? "Good" : "At Risk"
                    },
                    marks: {
                      average: avgMarks,
                      subjects: marks.length
                    }
                  },
                  financialSummary: {
                    pendingFees: hasPendingFees,
                    amount: pendingFeesAmount,
                    nextDueDate: hasPendingFees ? fees[0].due_date : null
                  },
                  recentNotifications: notifications,
                  todaySchedule: todayClasses
                });
              });
            }
          );
        });
      });
    });
  });
});

// Endpoint to add a new notification (for admin purposes)
app.post("/notifications", (req, res) => {
  const { message, category } = req.body;
  if (!message || !category) {
    return res.status(400).json({ message: "Message and category are required." });
  }
  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Then use it like:
  const date = formatDate(new Date());
  
  
  db.run(
    "INSERT INTO notifications (message, date, category) VALUES (?, ?, ?)",
    [message, date, category],
    function (err) {
      if (err) return res.status(500).json({ message: "Error adding notification", error: err.message });
      res.json({ message: "Notification added successfully!", id: this.lastID });
    }
  );
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});