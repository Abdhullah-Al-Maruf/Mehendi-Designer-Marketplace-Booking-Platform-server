import { Request, Response } from "express";

require("dotenv").config();
const { MongoClient, ServerApiVersion } = require('mongodb')
const express = require("express");
const cors = require("cors");



const app = express();

app.use(cors());
app.use(express.json());


const uri=process.env.MONGODB_URI
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
try {
  
    // await client.connect();
    // Send a ping to confirm a successful connection

    const db = client.db("nusrat-mehedi-design");



    app.get("/", (req: Request, res: Response) => {
      res.send("Server Running");
    });


    app.listen(5000, () => {
      console.log("Server is running on port 5000");
    });
    
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);